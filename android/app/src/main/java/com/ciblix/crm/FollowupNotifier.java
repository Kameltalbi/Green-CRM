package com.ciblix.crm;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.Set;

/** Notifications locales des suggestions déjà calculées. Aucun envoi au prospect. */
final class FollowupNotifier {
    static final String PREFS = "ciblix.followups";
    private static final String CHANNEL = "relances";

    private FollowupNotifier() {}

    static void deliver(Context context, JSONArray items) {
        if (items == null || items.length() == 0) return;
        var prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("enabled", true)) return;
        if (quiet(prefs.getInt("quiet_start", 20), prefs.getInt("quiet_end", 8))) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Relances", NotificationManager.IMPORTANCE_DEFAULT));
        Set<String> seen = new HashSet<>(prefs.getStringSet("notified", Set.of()));
        int posted = 0;
        boolean changed = false;
        for (int i = 0; i < items.length() && posted < 3; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            String id = item.optString("id");
            if (id.isEmpty() || seen.contains(id)) continue;
            String name = item.optString("contact_name", "Contact");
            String reason = item.optString("reason", "Relance à faire");
            Notification notification = new Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(name)
                .setContentText(reason)
                .setStyle(new Notification.BigTextStyle().bigText(reason))
                .setAutoCancel(true)
                .build();
            manager.notify(id.hashCode(), notification);
            seen.add(id);
            changed = true;
            posted += 1;
        }
        if (changed) prefs.edit().putStringSet("notified", seen).apply();
    }

    private static boolean quiet(int start, int end) {
        if (start == end || start < 0 || start > 23 || end < 0 || end > 23) return false;
        int hour = LocalTime.now().getHour();
        return start < end ? hour >= start && hour < end : hour >= start || hour < end;
    }
}
