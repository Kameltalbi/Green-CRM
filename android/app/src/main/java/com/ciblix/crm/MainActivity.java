package com.ciblix.crm;

import android.app.*;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.content.*;
import android.text.InputType;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.net.URLEncoder;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public final class MainActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ApiClient api;
    private SessionStore sessions;
    private DocumentImportController documentImport;
    private UiKit ui;
    private LinearLayout root, content, navigation;
    private WebView web;
    private TextView status;
    private String section = "dashboard", query = "", organization = "Mon espace";
    private int offset = 0, generation = 0;
    private boolean busy = false;
    private static final DateTimeFormatter DAY_TIME = DateTimeFormatter.ofPattern("d MMM · HH:mm", Locale.FRENCH);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ui = new UiKit(this);
        sessions = new SessionStore(this);
        // Adresse API figée — jamais exposée dans l’UI.
        // Release / téléphone physique → https://ciblix.com
        // Debug sur émulateur uniquement → http://10.0.2.2:3000 (localhost du Mac).
        api = new ApiClient(apiBase());
        api.token = sessions.read();
        documentImport = new DocumentImportController(this, api, worker, () -> { if (!busy) show(); });
        if (state != null) {
            section = state.getString("section", "dashboard");
            query = state.getString("query", "");
            offset = state.getInt("offset");
        }
        if (api.token.isEmpty()) showLogin(state); else loadIdentity();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (documentImport != null) documentImport.onPermissionResult(requestCode, grantResults);
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (documentImport != null) documentImport.onActivityResult(requestCode, resultCode, data);
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("section", section);
        state.putString("query", query);
        state.putInt("offset", offset);
        if (web != null) web.saveState(state);
    }
    @Override protected void onDestroy() {
        generation++;
        if (web != null) { web.destroy(); web = null; }
        worker.shutdownNow();
        super.onDestroy();
    }

    private boolean debugBuild() { return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0; }

    private static boolean isEmulator() {
        String fp = Build.FINGERPRINT == null ? "" : Build.FINGERPRINT;
        String product = Build.PRODUCT == null ? "" : Build.PRODUCT;
        String model = Build.MODEL == null ? "" : Build.MODEL;
        String hardware = Build.HARDWARE == null ? "" : Build.HARDWARE;
        return fp.startsWith("generic") || fp.contains("emulator") || fp.contains("ranchu")
            || product.contains("sdk") || product.contains("emulator")
            || model.contains("Emulator") || model.contains("Android SDK")
            || "goldfish".equals(hardware) || "ranchu".equals(hardware)
            || "google_sdk".equals(product);
    }

    private String apiBase() {
        if (!debugBuild()) return "https://ciblix.com";
        return isEmulator() ? "http://10.0.2.2:3000" : "https://ciblix.com";
    }

    private int dp(int value) { return ui.dp(value); }

    private void frame(String title) {
        generation++;
        busy = false;
        if (web != null) { web.destroy(); web = null; }
        root = ui.column();
        root.setBackgroundColor(UiKit.BG);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            root.setPadding(dp(18), insets.getSystemWindowInsetTop() + dp(10), dp(18), insets.getSystemWindowInsetBottom() + dp(10));
            return insets;
        });

        LinearLayout header = ui.row();
        header.addView(ui.brandLogo(32));
        View spacer = new View(this);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(0, 1, 1));
        header.addView(spacer);
        TextView orgChip = ui.statusPill(organization, 0);
        header.addView(orgChip);
        root.addView(header);

        TextView heading = ui.title(title);
        heading.setPadding(0, dp(14), 0, dp(2));
        root.addView(heading);

        status = ui.subtitle("");
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        content = ui.column();
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        navigation = ui.column();
        navigation.setPadding(0, dp(10), 0, 0);
        root.addView(navigation);
        setContentView(root);
        root.requestApplyInsets();
    }

    private void attachNav() {
        String[] routes = {"dashboard", "contacts", "companies", "followups"};
        String[] labels = {"Accueil", "Contacts", "Entreprises", "Relances"};
        LinearLayout bar = ui.row();
        bar.setBackground(ui.round(UiKit.SURFACE, 16));
        bar.setPadding(dp(6), dp(6), dp(6), dp(6));
        bar.setElevation(dp(2));
        for (int i = 0; i < routes.length; i++) {
            final String route = routes[i];
            Button chip = ui.navItem(labels[i], section.equals(route), () -> {
                if (busy) return;
                section = route;
                offset = 0;
                query = "";
                show();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
            lp.setMargins(dp(2), 0, dp(2), 0);
            bar.addView(chip, lp);
        }
        navigation.addView(bar);
    }

    interface Task { JSONObject run() throws Exception; }
    interface Done { void run(JSONObject data) throws Exception; }
    private void run(Task task, Done done) {
        if (busy) return;
        busy = true;
        status.setText("Chargement…");
        final int current = generation;
        worker.execute(() -> {
            JSONObject result = null;
            Exception failure = null;
            try { result = task.run(); } catch (Exception e) { failure = e; }
            final JSONObject data = result;
            final Exception error = failure;
            runOnUiThread(() -> {
                if (isDestroyed() || current != generation) return;
                busy = false;
                status.setText("");
                try {
                    if (error != null) throw error;
                    done.run(data);
                } catch (Exception e) {
                    if (e instanceof ApiClient.Failure && ((ApiClient.Failure) e).status == 401 && !api.token.isEmpty()) {
                        sessions.clear();
                        api.token = "";
                        showLogin(null);
                    } else {
                        status.setTextColor(UiKit.DANGER);
                        status.setText(e instanceof java.io.IOException
                            ? "Serveur inaccessible. Vérifiez l’adresse et la connexion, puis réessayez."
                            : e.getMessage());
                    }
                }
            });
        });
    }

    private static final int LOGIN_MINT = Color.rgb(194, 222, 209); // #C2DED1 maquette
    private static final int LOGIN_FIELD = Color.rgb(235, 242, 240); // #EBF2F0

    private EditText loginField(int iconRes, String hint, int inputType) {
        EditText field = new EditText(this);
        field.setTextSize(15);
        field.setHint(hint);
        field.setInputType(inputType);
        field.setSingleLine(true);
        field.setContentDescription(hint);
        field.setTextColor(UiKit.PETROLEUM);
        field.setHintTextColor(UiKit.MUTED);
        field.setBackground(ui.round(LOGIN_FIELD, 14));
        field.setMinHeight(dp(50));
        field.setCompoundDrawablesRelativeWithIntrinsicBounds(iconRes, 0, 0, 0);
        field.setCompoundDrawablePadding(dp(12));
        field.setPadding(dp(14), dp(13), dp(14), dp(13));
        field.setGravity(Gravity.CENTER_VERTICAL);
        return field;
    }

    private void showLogin(Bundle state) {
        if (state != null && state.getBoolean("webLogin", false)) {
            openSite(state);
            return;
        }
        generation++;
        busy = false;
        if (web != null) { web.destroy(); web = null; }

        // Fond maquette : vagues + illustration laptop / pictos commerciaux.
        FrameLayout shell = new FrameLayout(this);
        shell.setBackgroundColor(Color.rgb(245, 249, 248));
        ImageView backdrop = new ImageView(this);
        backdrop.setImageResource(R.drawable.bg_login);
        backdrop.setScaleType(ImageView.ScaleType.CENTER_CROP);
        backdrop.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        shell.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));

        root = ui.column();
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            root.setPadding(dp(22), insets.getSystemWindowInsetTop() + dp(18), dp(22), insets.getSystemWindowInsetBottom() + dp(16));
            return insets;
        });
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        content = ui.column();
        content.setGravity(Gravity.CENTER_HORIZONTAL);

        ImageView logo = ui.brandLogo(34);
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(-2, dp(34));
        logoLp.gravity = Gravity.CENTER_HORIZONTAL;
        content.addView(logo, logoLp);

        TextView title = ui.title("Connexion");
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        title.setTextSize(28);
        title.setPadding(0, dp(14), 0, 0);
        content.addView(title);
        TextView intro = ui.subtitle("Accédez à votre espace commercial.");
        intro.setGravity(Gravity.CENTER_HORIZONTAL);
        intro.setPadding(0, dp(4), 0, dp(18));
        content.addView(intro);

        LinearLayout card = ui.surfaceCard();
        card.setPadding(dp(18), dp(18), dp(18), dp(16));
        card.setElevation(dp(5));
        ui.margin(card, 0, 0);

        TextView emailLabel = ui.label("E-mail", 13, UiKit.MUTED, false);
        emailLabel.setPadding(0, 0, 0, dp(6));
        card.addView(emailLabel);
        EditText email = loginField(R.drawable.ic_email, "Votre e-mail", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        card.addView(email);

        TextView passLabel = ui.label("Mot de passe", 13, UiKit.MUTED, false);
        passLabel.setPadding(0, dp(12), 0, dp(6));
        card.addView(passLabel);
        FrameLayout passWrap = new FrameLayout(this);
        EditText password = loginField(R.drawable.ic_lock, "Votre mot de passe", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        password.setPadding(dp(14), dp(13), dp(48), dp(13));
        passWrap.addView(password, new FrameLayout.LayoutParams(-1, -2));
        ImageButton toggle = new ImageButton(this);
        toggle.setImageResource(R.drawable.ic_visibility);
        toggle.setBackgroundColor(Color.TRANSPARENT);
        toggle.setContentDescription("Afficher le mot de passe");
        toggle.setPadding(dp(12), dp(12), dp(12), dp(12));
        final boolean[] visible = {false};
        toggle.setOnClickListener(v -> {
            visible[0] = !visible[0];
            int start = password.getSelectionStart();
            password.setInputType(visible[0]
                ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
            password.setSelection(Math.max(0, start));
            password.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_lock, 0, 0, 0);
            toggle.setImageResource(visible[0] ? R.drawable.ic_visibility_off : R.drawable.ic_visibility);
            toggle.setContentDescription(visible[0] ? "Masquer le mot de passe" : "Afficher le mot de passe");
        });
        passWrap.addView(toggle, new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.END | Gravity.CENTER_VERTICAL));
        card.addView(passWrap);

        status = ui.subtitle("");
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        status.setPadding(0, dp(6), 0, 0);
        card.addView(status);

        Button connect = ui.primary("Se connecter", () -> {
            if (busy) return;
            String address = email.getText().toString().trim();
            String secret = password.getText().toString();
            if (address.isEmpty() || secret.isEmpty()) {
                status.setTextColor(UiKit.DANGER);
                status.setText("Indiquez votre e-mail et votre mot de passe.");
                return;
            }
            try {
                JSONObject body = new JSONObject().put("email", address).put("password", secret);
                run(() -> api.request("POST", "/api/auth/sign-in/email", body), data -> {
                    sessions.save(api.token);
                    loadIdentity();
                });
            } catch (Exception e) {
                status.setTextColor(UiKit.DANGER);
                status.setText(e.getMessage());
            }
        });
        LinearLayout.LayoutParams connectLp = (LinearLayout.LayoutParams) connect.getLayoutParams();
        connectLp.topMargin = dp(14);
        connectLp.bottomMargin = dp(8);
        card.addView(connect);

        Button signup = ui.secondary("Créer un compte", () -> openSite(null));
        signup.setBackground(ui.round(LOGIN_MINT, 12));
        signup.setTextColor(UiKit.PETROLEUM);
        signup.setTypeface(null, android.graphics.Typeface.BOLD);
        LinearLayout.LayoutParams signupLp = (LinearLayout.LayoutParams) signup.getLayoutParams();
        signupLp.topMargin = 0;
        signupLp.bottomMargin = 0;
        card.addView(signup);

        content.addView(card);
        // Laisse visible l’illustration bas de page (laptop / pictos).
        View spacer = new View(this);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(-1, dp(160)));
        content.addView(spacer);

        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        shell.addView(root, new FrameLayout.LayoutParams(-1, -1));
        setContentView(shell);
        root.requestApplyInsets();
    }

    private void openSite(Bundle state) {
        generation++;
        busy = false;
        if (web != null) { web.destroy(); web = null; }
        web = new WebView(this);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.setBackgroundColor(UiKit.BG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                android.net.Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                String host = uri.getHost();
                String expected = android.net.Uri.parse(api.base).getHost();
                if (("https".equals(scheme) || "http".equals(scheme)) && host != null && host.equalsIgnoreCase(expected)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (!request.isForMainFrame()) return;
                String entry = api.base + "/connexion";
                view.loadDataWithBaseURL(entry,
                    "<html><body style=\"font-family:sans-serif;padding:32px;background:#F4F7F6;color:#173D41\">"
                        + "<h1>Ciblix</h1><p>La page est inaccessible. Vérifiez la connexion, puis réessayez.</p>"
                        + "<p><a href=\"" + entry + "\">Réessayer</a></p></body></html>",
                    "text/html", "utf-8", null);
            }
        });
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(web);
        web.requestApplyInsets();
        if (state == null || web.restoreState(state) == null) web.loadUrl(api.base + "/inscription");
    }

    private void loadIdentity() {
        frame("Ouverture");
        content.addView(ui.subtitle("Préparation de votre espace…"));
        content.addView(ui.primary("Réessayer", this::loadIdentity));
        content.addView(ui.secondary("Changer de serveur / compte", () -> {
            sessions.clear();
            api.token = "";
            showLogin(null);
        }));
        attachNav();
        run(() -> api.request("GET", "/api/v1/account", null), account -> {
            JSONArray orgs = account.getJSONArray("organizations");
            if (orgs.length() == 0) { onboarding(); return; }
            loadWorkspace();
        });
    }
    private void loadWorkspace() {
        run(() -> api.request("GET", "/api/v1/me", null), me -> {
            organization = me.getJSONObject("organization").getString("name");
            show();
        });
    }
    private void onboarding() {
        frame("Créer votre espace");
        content.addView(ui.subtitle("Vous en serez l’administrateur."));
        LinearLayout card = ui.surfaceCard();
        ui.margin(card, 12, 0);
        EditText name = ui.field(card, "Nom de l’entreprise", "", InputType.TYPE_CLASS_TEXT);
        content.addView(card);
        content.addView(ui.primary("Créer mon espace", () -> {
            try {
                JSONObject body = new JSONObject().put("companyName", name.getText().toString().trim());
                run(() -> api.request("POST", "/api/v1/onboarding", body), d -> loadWorkspace());
            } catch (Exception e) {
                status.setTextColor(UiKit.DANGER);
                status.setText(e.getMessage());
            }
        }));
        attachNav();
    }

    private String title() {
        return switch (section) {
            case "contacts" -> "Contacts";
            case "companies" -> "Entreprises";
            case "followups" -> "Relances";
            default -> "Tableau de bord";
        };
    }

    private void show() {
        frame(title());
        attachNav();
        if (section.equals("dashboard")) renderDashboard();
        else if (section.equals("followups")) renderFollowups();
        else renderDirectory();
    }

    private void startScan() {
        if (busy || documentImport == null) return;
        documentImport.start(status);
    }

    private void renderDashboard() {
        LinearLayout tools = ui.row();
        tools.addView(ui.ghost("Actualiser", () -> { if (!busy) show(); }));
        View stretch = new View(this);
        stretch.setLayoutParams(new LinearLayout.LayoutParams(0, 1, 1));
        tools.addView(stretch);
        tools.addView(ui.ghost("Mon compte", this::accountMenu));
        content.addView(tools);

        // OCR au premier plan — avant les indicateurs statistiques.
        LinearLayout scan = ui.scanHero(
            "Scanner un document",
            "Carte de visite, fiche ou PDF · photo ou galerie · vérification avant enregistrement.",
            "Lancer le scan",
            this::startScan
        );
        ui.margin(scan, 4, 12);
        content.addView(scan);

        run(() -> api.request("GET", "/api/v1/dashboard", null), data -> {
            JSONObject counts = data.getJSONObject("counts");
            LinearLayout metrics = ui.row();
            metrics.setPadding(0, dp(4), 0, dp(4));
            String[] keys = {"contacts", "companies", "pending"};
            String[] names = {"Contacts", "Entreprises", "Relances"};
            for (int i = 0; i < keys.length; i++) {
                LinearLayout metric = ui.metricCard(names[i], counts.optString(keys[i], "0"));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
                if (i > 0) lp.leftMargin = dp(8);
                metrics.addView(metric, lp);
            }
            content.addView(metrics);

            JSONObject periods = data.getJSONObject("periods");
            String[] periodKeys = {"late", "today", "upcoming"};
            String[] periodNames = {"En retard", "Aujourd’hui", "À venir"};
            int[] tones = {2, 0, 1};
            boolean any = false;
            for (int i = 0; i < periodKeys.length; i++) {
                JSONObject page = periods.getJSONObject(periodKeys[i]);
                JSONArray items = page.getJSONArray("items");
                content.addView(ui.sectionHeader(periodNames[i], String.valueOf(page.optInt("total"))));
                if (items.length() == 0) {
                    LinearLayout empty = ui.surfaceCard();
                    empty.addView(ui.emptyState(i == 0 ? "Aucune relance en retard." : i == 1 ? "Rien pour aujourd’hui." : "Pas de relance à venir."));
                    ui.margin(empty, 0, 4);
                    content.addView(empty);
                } else {
                    any = true;
                    for (int j = 0; j < items.length(); j++) followupCard(items.getJSONObject(j), tones[i]);
                }
            }
            if (!any) {
                // keep empty states already shown
            }
        });
    }

    private void renderDirectory() {
        boolean contacts = section.equals("contacts");
        // Action OCR directe (pas via paramètres / menu secondaire).
        LinearLayout scan = ui.scanHero(
            contacts ? "Scanner une carte ou un contact" : "Scanner une fiche entreprise",
            "Appareil photo ou galerie · OCR Ciblix · corrigez avant d’enregistrer.",
            "Scanner maintenant",
            this::startScan
        );
        ui.margin(scan, 0, 10);
        content.addView(scan);

        LinearLayout searchRow = ui.row();
        EditText search = ui.searchField(query);
        search.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        searchRow.addView(search);
        Button go = ui.primary("OK", () -> {
            if (busy) return;
            query = search.getText().toString().trim();
            offset = 0;
            show();
        });
        LinearLayout.LayoutParams goLp = new LinearLayout.LayoutParams(-2, -2);
        goLp.leftMargin = dp(8);
        goLp.topMargin = 0;
        goLp.bottomMargin = 0;
        go.setLayoutParams(goLp);
        go.setPadding(dp(16), dp(12), dp(16), dp(12));
        searchRow.addView(go);
        content.addView(searchRow);

        content.addView(ui.primary("+ " + (contacts ? "Nouveau contact" : "Nouvelle entreprise"), () -> {
            if (!busy) edit(new JSONObject());
        }));

        final String route = section;
        run(() -> api.request("GET", "/api/v1/" + route + "?limit=25&offset=" + offset + "&q=" + URLEncoder.encode(query, "UTF-8"), null), data -> {
            JSONArray items = data.getJSONArray("items");
            int total = data.getInt("total");
            content.addView(ui.subtitle(total == 0 ? "Aucun résultat" : (offset + 1) + "–" + (offset + items.length()) + " sur " + total));
            if (total == 0) {
                LinearLayout empty = ui.surfaceCard();
                empty.addView(ui.emptyState(section.equals("contacts")
                    ? "Aucun contact pour l’instant. Créez une fiche ou importez un document."
                    : "Aucune entreprise pour l’instant."));
                ui.margin(empty, 8, 0);
                content.addView(empty);
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                String detail = route.equals("contacts")
                    ? join(" · ", clean(item, "job_title"), clean(item, "phone"))
                    : join(" · ", clean(item, "sector"), clean(item, "city"), clean(item, "relation_type"));
                LinearLayout row = ui.listRow(item.optString("name"), detail, "Ouvrir", () -> detail(item));
                ui.margin(row, 8, 0);
                content.addView(row);
            }
            LinearLayout pager = ui.row();
            if (offset > 0) {
                Button prev = ui.secondary("Précédent", () -> {
                    if (busy) return;
                    offset = Math.max(0, offset - 25);
                    show();
                });
                prev.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
                pager.addView(prev);
            }
            if (offset + items.length() < total) {
                Button next = ui.secondary("Suivant", () -> {
                    if (busy) return;
                    offset += 25;
                    show();
                });
                LinearLayout.LayoutParams nlp = new LinearLayout.LayoutParams(0, -2, 1);
                if (pager.getChildCount() > 0) nlp.leftMargin = dp(8);
                next.setLayoutParams(nlp);
                pager.addView(next);
            }
            if (pager.getChildCount() > 0) {
                ui.margin(pager, 12, 0);
                content.addView(pager);
            }
        });
    }

    private void renderFollowups() {
        content.addView(ui.primary("+ Planifier une relance", () -> {
            if (!busy) edit(new JSONObject());
        }));
        run(() -> api.request("GET", "/api/v1/followups?limit=25&offset=" + offset + "&q=" + URLEncoder.encode(query, "UTF-8"), null), data -> {
            JSONArray items = data.getJSONArray("items");
            int total = data.getInt("total");
            content.addView(ui.subtitle(total == 0 ? "Aucune relance" : (offset + 1) + "–" + (offset + items.length()) + " sur " + total));
            if (total == 0) {
                LinearLayout empty = ui.surfaceCard();
                empty.addView(ui.emptyState("Planifiez une relance pour garder le rythme commercial."));
                ui.margin(empty, 8, 0);
                content.addView(empty);
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                int tone = switch (item.optString("status")) {
                    case "completed" -> 0;
                    case "cancelled" -> 3;
                    default -> dueTone(clean(item, "due_at"));
                };
                followupCard(item, tone);
            }
            if (offset > 0) content.addView(ui.secondary("Page précédente", () -> {
                if (busy) return;
                offset = Math.max(0, offset - 25);
                show();
            }));
            if (offset + items.length() < total) content.addView(ui.secondary("Page suivante", () -> {
                if (busy) return;
                offset += 25;
                show();
            }));
        });
    }

    private int dueTone(String dueAt) {
        try {
            OffsetDateTime due = OffsetDateTime.parse(dueAt);
            OffsetDateTime now = OffsetDateTime.now();
            if (due.isBefore(now)) return 2;
            if (due.toLocalDate().equals(now.toLocalDate())) return 0;
            return 1;
        } catch (Exception e) {
            return 1;
        }
    }

    private String formatDue(String dueAt) {
        try {
            return DAY_TIME.format(OffsetDateTime.parse(dueAt));
        } catch (Exception e) {
            return dueAt;
        }
    }

    private String join(String sep, String... parts) {
        StringBuilder b = new StringBuilder();
        for (String part : parts) {
            if (part == null || part.trim().isEmpty()) continue;
            if (b.length() > 0) b.append(sep);
            b.append(part.trim());
        }
        return b.toString();
    }

    private String clean(JSONObject o, String key) { return o.isNull(key) ? "" : o.optString(key, ""); }

    private void followupCard(JSONObject item, int tone) {
        String state = switch (item.optString("status")) {
            case "completed" -> "Terminée";
            case "cancelled" -> "Annulée";
            default -> tone == 2 ? "En retard" : tone == 0 ? "Aujourd’hui" : "À venir";
        };
        LinearLayout card = ui.surfaceCard();
        ui.margin(card, 8, 0);
        LinearLayout top = ui.row();
        TextView subject = ui.label(item.optString("subject"), 16, UiKit.PETROLEUM, true);
        subject.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        top.addView(subject);
        top.addView(ui.statusPill(state, tone));
        card.addView(top);
        String due = clean(item, "due_at");
        if (!due.isEmpty()) card.addView(ui.subtitle(formatDue(due)));
        LinearLayout actions = ui.row();
        Button edit = ui.ghost("Modifier", () -> { if (!busy) editFollowup(item); });
        actions.addView(edit);
        if (item.optString("status").equals("pending")) {
            Button done = ui.ghost("Terminer", () -> {
                if (busy) return;
                try {
                    JSONObject body = new JSONObject().put("status", "completed");
                    run(() -> api.request("PATCH", "/api/v1/followups/" + item.getString("id"), body), d -> show());
                } catch (Exception e) {
                    status.setTextColor(UiKit.DANGER);
                    status.setText(e.getMessage());
                }
            });
            actions.addView(done);
        }
        card.addView(actions);
        content.addView(card);
    }

    private void detail(JSONObject item) {
        if (busy) return;
        String route = section;
        run(() -> api.request("GET", "/api/v1/" + route + "/" + item.getString("id"), null), record -> {
            LinearLayout body = ui.column();
            body.setPadding(dp(8), 0, dp(8), 0);
            body.addView(ui.title(record.optString("name")));
            String[] keys = route.equals("contacts")
                ? new String[]{"job_title", "department", "phone", "phone_work", "whatsapp", "source", "status"}
                : new String[]{"sector", "relation_type", "city", "country", "phone", "email", "website", "status", "source", "company_size", "description", "address", "linkedin", "socials"};
            for (String key : keys) {
                String value = clean(record, key);
                if (value.trim().isEmpty()) continue;
                body.addView(ui.caption(key.replace('_', ' ')));
                body.addView(ui.label(value, 15, UiKit.PETROLEUM, false));
            }
            body.addView(ui.primary("Modifier", () -> edit(record)));
            body.addView(ui.secondary("Ajouter une note", () -> note(route, record)));
            body.addView(ui.secondary("Planifier une relance", () -> {
                try {
                    JSONObject draft = new JSONObject().put(route.equals("contacts") ? "contact_id" : "company_id", record.getString("id"));
                    editFollowup(draft);
                } catch (Exception e) {
                    status.setTextColor(UiKit.DANGER);
                    status.setText(e.getMessage());
                }
            }));
            ScrollView scroll = new ScrollView(this);
            scroll.addView(body);
            new AlertDialog.Builder(this).setView(scroll).setPositiveButton("Fermer", null).show();
        });
    }
    private void note(String route, JSONObject record) {
        LinearLayout wrap = ui.column();
        wrap.setPadding(dp(8), 0, dp(8), 0);
        EditText input = new EditText(this);
        input.setMinLines(3);
        input.setHint("Note partagée");
        input.setTextSize(16);
        input.setBackground(ui.round(UiKit.FIELD, 12));
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        wrap.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Ajouter une note").setView(wrap).setNegativeButton("Annuler", null).setPositiveButton("Enregistrer", null).create();
        dialog.setOnShowListener(v -> dialog.getButton(-1).setOnClickListener(b -> {
            if (input.getText().toString().trim().isEmpty()) { input.setError("Saisissez une note."); return; }
            try {
                JSONObject body = new JSONObject().put("body", input.getText().toString()).put(route.equals("contacts") ? "contact_id" : "company_id", record.getString("id"));
                run(() -> api.request("POST", "/api/v1/notes", body), d -> {
                    dialog.dismiss();
                    status.setTextColor(UiKit.SAGE);
                    status.setText("Note enregistrée.");
                });
            } catch (Exception e) {
                status.setTextColor(UiKit.DANGER);
                status.setText(e.getMessage());
            }
        }));
        dialog.show();
    }
    private void edit(JSONObject record) {
        if (section.equals("followups")) editFollowup(record);
        else editRecord(record);
    }
    private void editRecord(JSONObject record) {
        String route = section;
        boolean contact = route.equals("contacts");
        String[] keys = contact
            ? new String[]{"name", "job_title", "department", "phone", "phone_work", "whatsapp", "source", "status"}
            : new String[]{"name", "sector", "relation_type", "description", "phone", "email", "website", "address", "city", "country", "source", "status", "company_size", "linkedin", "socials"};
        String[] labels = contact
            ? new String[]{"Nom *", "Fonction", "Service", "Mobile", "Téléphone pro", "WhatsApp", "Source", "Statut"}
            : new String[]{"Nom *", "Secteur", "Relation (prospect/client/…)", "Description", "Téléphone", "E-mail", "Site web", "Adresse", "Ville", "Pays", "Source", "Statut", "Taille", "LinkedIn", "Autres réseaux"};
        form(record, route, keys, labels);
    }
    private void editFollowup(JSONObject record) {
        form(record, "followups", new String[]{"subject", "due_at"}, new String[]{"Objet *", "Échéance avec fuseau (ex. 2026-11-01T09:00:00+01:00) *"});
    }
    private void form(JSONObject record, String route, String[] keys, String[] labels) {
        LinearLayout body = ui.column();
        body.setPadding(dp(8), 0, dp(8), 0);
        EditText[] fields = new EditText[keys.length];
        for (int i = 0; i < keys.length; i++) fields[i] = ui.field(body, labels[i], clean(record, keys[i]), InputType.TYPE_CLASS_TEXT);
        TextView error = ui.subtitle("");
        error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        body.addView(error);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(body);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle(record.has("id") ? "Modifier" : "Créer").setView(scroll).setNegativeButton("Annuler", null).setPositiveButton("Enregistrer", null).create();
        dialog.setOnShowListener(v -> dialog.getButton(-1).setOnClickListener(b -> {
            if (busy) return;
            if (fields[0].getText().toString().trim().isEmpty()) { fields[0].setError("Champ requis"); return; }
            try {
                JSONObject payload = new JSONObject();
                for (int i = 0; i < keys.length; i++) payload.put(keys[i], fields[i].getText().toString().trim());
                if (route.equals("followups")) {
                    try { OffsetDateTime.parse(payload.getString("due_at")); }
                    catch (Exception e) { fields[1].setError("Date ISO avec fuseau requise"); return; }
                    for (String key : new String[]{"contact_id", "company_id"})
                        if (record.has(key) && !record.has("id")) payload.put(key, record.get(key));
                }
                String path = "/api/v1/" + route + (record.has("id") ? "/" + record.getString("id") : "");
                dialog.getButton(-1).setEnabled(false);
                final int current = generation;
                busy = true;
                error.setTextColor(UiKit.MUTED);
                error.setText("Enregistrement…");
                worker.execute(() -> {
                    Exception failure = null;
                    try { api.request(record.has("id") ? "PATCH" : "POST", path, payload); }
                    catch (Exception e) { failure = e; }
                    final Exception problem = failure;
                    runOnUiThread(() -> {
                        if (isDestroyed() || current != generation) return;
                        busy = false;
                        dialog.getButton(-1).setEnabled(true);
                        if (problem == null) { dialog.dismiss(); show(); }
                        else if (problem instanceof ApiClient.Failure && ((ApiClient.Failure) problem).status == 401) {
                            dialog.dismiss();
                            sessions.clear();
                            api.token = "";
                            showLogin(null);
                        } else {
                            error.setTextColor(UiKit.DANGER);
                            error.setText(problem.getMessage());
                        }
                    });
                });
            } catch (Exception e) {
                error.setTextColor(UiKit.DANGER);
                error.setText(e.getMessage());
            }
        }));
        dialog.show();
    }
    private void accountMenu() {
        if (busy) return;
        run(() -> api.request("GET", "/api/v1/me", null), me -> {
            JSONArray orgs = me.getJSONArray("organizations");
            LinearLayout body = ui.column();
            body.setPadding(dp(8), 0, dp(8), 0);
            body.addView(ui.caption("Compte"));
            body.addView(ui.label(me.getJSONObject("user").getString("email"), 15, UiKit.PETROLEUM, false));
            body.addView(ui.caption("Espaces"));
            for (int i = 0; i < orgs.length(); i++) {
                JSONObject org = orgs.getJSONObject(i);
                body.addView(ui.secondary(org.getString("name"), () -> {
                    try {
                        JSONObject payload = new JSONObject().put("organization_id", org.getString("id"));
                        run(() -> api.request("POST", "/api/v1/organizations/switch", payload), d -> {
                            section = "dashboard";
                            offset = 0;
                            query = "";
                            loadIdentity();
                        });
                    } catch (Exception e) {
                        status.setTextColor(UiKit.DANGER);
                        status.setText(e.getMessage());
                    }
                }));
            }
            body.addView(ui.primary("Se déconnecter", () -> run(() -> api.request("POST", "/api/v1/auth/logout", new JSONObject()), d -> {
                sessions.clear();
                api.token = "";
                showLogin(null);
            })));
            ScrollView scroll = new ScrollView(this);
            scroll.addView(body);
            new AlertDialog.Builder(this).setTitle("Paramètres").setView(scroll).setPositiveButton("Fermer", null).show();
        });
    }
}
