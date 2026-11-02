#!/usr/bin/env bash
# Installe l’APK debug, se connecte au compte démo local, capture les écrans authentifiés.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"
APK="${1:-/tmp/ciblix-0.1.8.apk}"
OUT="${2:-/Volumes/Projets/green crm/test-results/android-refonte-0.1.8}"
AVD="${3:-abc_cash_pixel7}"
EMAIL='demo.refonte@ciblix.local'
PASSWORD='DemoRefonte2026!'
mkdir -p "$OUT"

pkill -f 'qemu-system' 2>/dev/null || true
pkill -f 'emulator -avd' 2>/dev/null || true
sleep 2
adb kill-server >/dev/null 2>&1 || true
adb start-server >/dev/null

nohup emulator -avd "$AVD" -no-snapshot-load -no-audio -no-boot-anim -gpu swiftshader_indirect >/tmp/ciblix-emu-auth.log 2>&1 &
EMPID=$!
echo "emulator pid=$EMPID"

for i in $(seq 1 100); do
  boot=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  echo "boot wait $i => $boot"
  [[ "$boot" == "1" ]] && break
  kill -0 "$EMPID" 2>/dev/null || { echo "emulator died"; tail -40 /tmp/ciblix-emu-auth.log; exit 1; }
  sleep 3
done
sleep 6

adb install -r "$APK"
adb shell am force-stop com.ciblix.crm
adb shell pm clear com.ciblix.crm >/dev/null 2>&1 || true
adb shell am start -n com.ciblix.crm/.MainActivity
sleep 5

dump_ui() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null
  adb pull /sdcard/ui.xml "$OUT/ui-latest.xml" >/dev/null
}

bounds_center() {
  # args: attribute pattern e.g. text="E-mail" or class=... 
  local xml="$OUT/ui-latest.xml"
  local match
  match=$(python3 - "$xml" "$1" <<'PY'
import re,sys
xml=open(sys.argv[1],encoding='utf-8').read()
key=sys.argv[2]
# Find node containing key, extract bounds
for m in re.finditer(r'<node [^>]*'+re.escape(key)+r'[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
    x1,y1,x2,y2=map(int,m.groups()); print((x1+x2)//2,(y1+y2)//2); break
else:
    # key may appear before bounds
    for m in re.finditer(r'<node ([^>]*)>', xml):
        attrs=m.group(1)
        if key in attrs:
            b=re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', attrs)
            if b:
                x1,y1,x2,y2=map(int,b.groups()); print((x1+x2)//2,(y1+y2)//2); break
PY
)
  echo "$match"
}

type_ascii() {
  # adb input text: escape spaces and specials
  local s="$1"
  s=${s// /%s}
  s=${s//!/\\!}
  s=${s//@/\\@}
  adb shell input text "$s"
}

# Dismiss System UI ANR if present
for _ in 1 2 3; do
  dump_ui
  if rg -q 'System UI isn' "$OUT/ui-latest.xml"; then
    c=$(bounds_center 'text="Wait"') || true
    if [[ -n "${c:-}" ]]; then adb shell input tap $c; sleep 2; fi
  else
    break
  fi
done

dump_ui
rg -o 'text="[^"]+"' "$OUT/ui-latest.xml" | head -30 || true

# Tap email EditText: after label E-mail — prefer focused password fields by content-desc
email_c=$(bounds_center 'content-desc="E-mail"' || true)
pass_c=$(bounds_center 'content-desc="Mot de passe"' || true)
login_c=$(bounds_center 'text="Se connecter"' || true)

if [[ -z "${email_c:-}" || -z "${pass_c:-}" || -z "${login_c:-}" ]]; then
  echo "LOGIN_UI_MISSING"
  cp "$OUT/ui-latest.xml" "$OUT/android-login-fail.xml"
  adb exec-out screencap -p > "$OUT/android-login.png" || true
  exit 2
fi

adb shell input tap $email_c
sleep 0.4
adb shell input keyevent KEYCODE_MOVE_END
adb shell input keyevent --longpress KEYCODE_DEL || true
# clear field roughly
for _ in $(seq 1 40); do adb shell input keyevent KEYCODE_DEL >/dev/null; done
type_ascii "$EMAIL"
sleep 0.3
adb shell input tap $pass_c
sleep 0.3
for _ in $(seq 1 40); do adb shell input keyevent KEYCODE_DEL >/dev/null; done
type_ascii "$PASSWORD"
sleep 0.3
adb shell input tap $login_c

# Wait for dashboard
ok=0
for i in $(seq 1 40); do
  sleep 2
  dump_ui
  if rg -q 'Tableau de bord|Contacts|Relances ouvertes|Accueil' "$OUT/ui-latest.xml"; then
    ok=1
    break
  fi
  # dismiss ANR
  if rg -q 'System UI isn|isn.t responding' "$OUT/ui-latest.xml"; then
    c=$(bounds_center 'text="Wait"' || true)
    [[ -n "${c:-}" ]] && adb shell input tap $c
  fi
  echo "auth wait $i"
  rg -o 'text="[^"]+"' "$OUT/ui-latest.xml" | head -20 || true
done

adb exec-out screencap -p > "$OUT/android-login-after.png"
if [[ "$ok" != "1" ]]; then
  echo "AUTH_FAILED"
  exit 3
fi

shot_section() {
  local name="$1" label="$2"
  dump_ui
  c=$(bounds_center "text=\"$label\"" || true)
  if [[ -z "${c:-}" ]]; then echo "missing nav $label"; return 1; fi
  adb shell input tap $c
  sleep 3
  # dismiss ANR
  dump_ui
  if rg -q 'System UI isn|isn.t responding' "$OUT/ui-latest.xml"; then
    w=$(bounds_center 'text="Wait"' || true)
    [[ -n "${w:-}" ]] && adb shell input tap $w
    sleep 2
  fi
  adb exec-out screencap -p > "$OUT/$name.png"
  dump_ui
  cp "$OUT/ui-latest.xml" "$OUT/$name-ui.xml"
  echo "SHOT $name"
  rg -o 'text="[^"]+"' "$OUT/$name-ui.xml" | head -25 || true
}

adb exec-out screencap -p > "$OUT/android-dashboard.png"
cp "$OUT/ui-latest.xml" "$OUT/android-dashboard-ui.xml"
echo "SHOT android-dashboard"
shot_section android-contacts Contacts || true
shot_section android-companies Entreprises || true
shot_section android-followups Relances || true

echo "DONE captures in $OUT"
ls -la "$OUT"/*.png
