package com.ciblix.crm;

import android.app.*;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
    private LinearLayout root, content, navigation, chrome, directoryList;
    private WebView web;
    private TextView status, directoryCount;
    private ProgressBar directoryProgress;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable directorySearchTask = () -> fetchDirectory(true);
    private String section = "dashboard", query = "", followupScope = "", organization = "Mon espace", personName = "", chartWindow = "6m", contactId = "", membershipRole = "member", closureStatus = "";
    private int contactPane = 0;
    private JSONObject contactSeed;
    private JSONArray members;
    private ContactRecordScreen contactScreen;
    private JSONObject dashboardPayload;
    private View portfolioHost;
    private ImageButton notifyButton;
    private View notifyDot;
    private int notifyLate;
    private int offset = 0, generation = 0, directoryTicket = 0;
    private boolean busy = false, directoryLoading = false, layoutPreview = false;
    private long lastCreateTap = 0;
    private static final DateTimeFormatter DAY_TIME = DateTimeFormatter.ofPattern("d MMM · HH:mm", Locale.FRENCH);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ui = new UiKit(this);
        sessions = new SessionStore(this);
        // Téléphone et APK installables : toujours la production (jamais 10.0.2.2).
        api = new ApiClient("https://ciblix.com");
        api.token = sessions.read();
        documentImport = new DocumentImportController(this, api, worker, () -> {
            if (busy) return;
            offset = 0;
            query = "";
            show();
        });
        layoutPreview = debugBuild() && getIntent() != null && getIntent().getBooleanExtra("layout_preview", false);
        if (state != null && !layoutPreview) {
            section = state.getString("section", "dashboard");
            query = state.getString("query", "");
            offset = state.getInt("offset");
            contactId = state.getString("contactId", "");
            contactPane = state.getInt("contactPane");
            documentImport.restoreState(state);
        }
        if (layoutPreview) {
            organization = "CarboScan";
            String previewName = getIntent().getStringExtra("preview_name");
            if (previewName != null && !previewName.isBlank()) personName = previewName;
            String asked = getIntent().getStringExtra("section");
            if (asked != null && !asked.isEmpty()) section = asked;
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);
            show();
            return;
        }
        if (api.token.isEmpty()) showLogin(state); else loadIdentity();
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (documentImport != null) documentImport.onPermissionResult(requestCode, grantResults);
    }
    @Override protected void onResume() {
        super.onResume();
        if (documentImport != null) documentImport.onHostResume();
    }
    @Override protected void onPause() {
        if (documentImport != null) documentImport.onHostPause();
        super.onPause();
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (documentImport != null) documentImport.onActivityResult(requestCode, resultCode, data);
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        if ("contact".equals(section)) {
            if (contactScreen != null && contactScreen.handleBack()) return;
            closeContact();
            return;
        }
        if ("settings".equals(section)) {
            section = "dashboard";
            show();
            return;
        }
        super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putString("section", section);
        state.putString("query", query);
        state.putInt("offset", offset);
        state.putString("contactId", contactId);
        state.putInt("contactPane", contactPane);
        if (documentImport != null) documentImport.saveState(state);
        if (web != null) web.saveState(state);
    }
    @Override protected void onDestroy() {
        generation++;
        if (web != null) { web.destroy(); web = null; }
        worker.shutdownNow();
        super.onDestroy();
    }

    private boolean debugBuild() { return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0; }

    private int dp(int value) { return ui.dp(value); }

    private void frame(String title) {
        generation++;
        busy = false;
        if (web != null) { web.destroy(); web = null; }
        root = ui.column();
        root.setBackgroundColor(UiKit.BG);
        int side = dp(16);
        final int topPad = "dashboard".equals(section) ? dp(4) : dp(12);
        root.setPadding(side, topPad, side, dp(6));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(side, topPad + insets.getSystemWindowInsetTop(), side, dp(6) + insets.getSystemWindowInsetBottom());
            return insets;
        });

        if ("dashboard".equals(section)) root.addView(dashboardTop());
        else {
            LinearLayout header = ui.row();
            header.addView(ui.brandLogo(28));
            View spacer = new View(this);
            spacer.setLayoutParams(new LinearLayout.LayoutParams(0, 1, 1));
            header.addView(spacer);
            header.addView(ui.orgBadge(organization));
            root.addView(header);
        }

        if (title != null && !title.isEmpty()) {
            LinearLayout titleRow = ui.row();
            titleRow.setPadding(0, dp(18), 0, 0);
            TextView heading = ui.pageTitle(title);
            if ("followups".equals(section)) heading.setTextColor(followupAccent());
            heading.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
            titleRow.addView(heading);
            if ("followups".equals(section)) {
                int accent = followupAccent();
                titleRow.addView(ui.squareAction(R.drawable.ic_plus, UiKit.wash(accent), accent, "Planifier une relance", () -> {
                    if (!busy) edit(new JSONObject());
                }));
            }
            root.addView(titleRow);
        }

        status = ui.subtitle("");
        status.setVisibility(View.GONE);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);
        if (documentImport != null) documentImport.attachStatus(status);

        chrome = ui.column();
        root.addView(chrome);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        content = ui.column();
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));

        navigation = ui.column();
        navigation.setPadding(0, dp(4), 0, 0);
        root.addView(navigation);
        setContentView(root);
        root.requestApplyInsets();
    }

    private void attachNav() {
        String[] routes = {"dashboard", "contacts", "companies", "followups", "more"};
        String[] labels = {"Accueil", "Contacts", "Entreprises", "Relances", "Plus"};
        int[] icons = {R.drawable.ic_home, R.drawable.ic_people, R.drawable.ic_building, R.drawable.ic_bell, R.drawable.ic_more};
        int[] accents = {UiKit.SAGE, UiKit.BLUE, UiKit.TURQUOISE, UiKit.CORAL, UiKit.ORANGE};
        LinearLayout bar = ui.row();
        bar.setBackground(ui.round(UiKit.SURFACE, 22));
        bar.setPadding(dp(3), dp(3), dp(3), dp(3));
        bar.setElevation(dp(2));
        for (int i = 0; i < routes.length; i++) {
            final String route = routes[i];
            boolean selected = "settings".equals(section) ? "more".equals(route) : !"more".equals(route) && (section.equals(route) || ("contact".equals(section) && "contacts".equals(route)));
            LinearLayout tab = ui.navTab(icons[i], labels[i], selected, accents[i], () -> {
                if (busy) return;
                if ("more".equals(route)) { openMore(); return; }
                followupScope = "";
                section = route;
                offset = 0;
                query = "";
                show();
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
            lp.setMargins(dp(2), 0, dp(2), 0);
            bar.addView(tab, lp);
        }
        navigation.addView(bar);
    }

    interface Task { JSONObject run() throws Exception; }
    interface Done { void run(JSONObject data) throws Exception; }
    private void run(Task task, Done done) {
        if (busy) return;
        busy = true;
        if (!"dashboard".equals(section)) showStatus("Chargement…", UiKit.MUTED);
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
                showStatus("", UiKit.MUTED);
                try {
                    if (error != null) throw error;
                    done.run(data);
                } catch (Exception e) {
                    if (e instanceof ApiClient.Failure && ((ApiClient.Failure) e).status == 401 && !api.token.isEmpty() && !layoutPreview) {
                        sessions.clear();
                        api.token = "";
                        showLogin(null);
                    } else {
                        showStatus(e instanceof java.io.IOException
                            ? "Serveur inaccessible. Vérifiez la connexion, puis réessayez."
                            : e.getMessage(), UiKit.DANGER);
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

        Button connect = ui.vivid("Se connecter", UiKit.SAGE, () -> {
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
            JSONObject space = me.getJSONObject("organization");
            organization = space.getString("name");
            membershipRole = space.optString("role", "member");
            closureStatus = space.optString("closure_status", "");
            members = me.optJSONArray("members");
            personName = me.getJSONObject("user").optString("name", "");
            show();
            if (documentImport != null) documentImport.offerPendingCapture();
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

    private void showStatus(String message, int color) {
        if (status == null) return;
        boolean empty = message == null || message.trim().isEmpty();
        status.setText(empty ? "" : message);
        status.setVisibility(empty ? View.GONE : View.VISIBLE);
        if (!empty) status.setTextColor(color);
    }

    private String title() {
        return switch (section) {
            case "contacts" -> "Contacts";
            case "companies" -> "Entreprises";
            case "followups" -> switch (followupScope) {
                case "late" -> "En retard";
                case "today" -> "Aujourd’hui";
                case "soon", "upcoming" -> "À venir";
                case "completed" -> "Terminées";
                default -> "Relances";
            };
            case "settings" -> "Paramètres";
            default -> "Vue d’ensemble";
        };
    }

    private void show() {
        uiHandler.removeCallbacks(directorySearchTask);
        if (!"contact".equals(section)) contactScreen = null;
        boolean directory = section.equals("contacts") || section.equals("companies");
        frame(directory || section.equals("dashboard") || section.equals("contact") ? "" : title());
        attachNav();
        if (section.equals("dashboard")) renderDashboard();
        else if (section.equals("followups")) renderFollowups();
        else if (section.equals("settings")) renderSettings();
        else if (section.equals("contact")) renderContact();
        else renderDirectory();
    }

    private void startScan() {
        if (busy || documentImport == null) return;
        documentImport.start(status);
    }

    private LinearLayout dashboardTop() {
        LinearLayout block = ui.column();
        LinearLayout brand = ui.row();
        brand.addView(ui.brandLogo(22));
        TextView divider = ui.label("|", 15, Color.rgb(210, 220, 218), false);
        divider.setPadding(dp(6), 0, dp(6), 0);
        brand.addView(divider);
        TextView product = ui.label("CRM Commercial", 12, UiKit.MUTED, false);
        product.setPadding(0, 0, dp(6), 0);
        product.setMaxLines(1);
        product.setEllipsize(android.text.TextUtils.TruncateAt.END);
        product.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        brand.addView(product);
        brand.addView(orgSelector());
        brand.addView(notifyBell());
        block.addView(brand);
        return block;
    }

    private String greeting() {
        String name = personName == null ? "" : personName.trim();
        if (name.isEmpty()) return "Bonjour";
        int space = name.indexOf(' ');
        String first = space > 0 ? name.substring(0, space) : name;
        return "Bonjour " + first + ",";
    }

    private FrameLayout notifyBell() {
        notifyButton = new ImageButton(this);
        notifyButton.setImageResource(R.drawable.ic_bell);
        notifyButton.setColorFilter(UiKit.PETROLEUM);
        notifyButton.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        notifyButton.setBackground(ui.round(Color.WHITE, 999));
        notifyButton.setBackgroundTintList(null);
        notifyButton.setStateListAnimator(null);
        notifyButton.setPadding(dp(8), dp(8), dp(8), dp(8));
        notifyButton.setMinimumWidth(0);
        notifyButton.setMinimumHeight(0);
        notifyButton.setContentDescription("Notifications");
        notifyButton.setOnClickListener(v -> {
            if (!busy) openSection("followups", notifyLate > 0 ? "late" : "");
        });
        FrameLayout bell = new FrameLayout(this);
        bell.addView(notifyButton, new FrameLayout.LayoutParams(dp(36), dp(36)));
        notifyDot = new View(this);
        notifyDot.setBackground(ui.round(UiKit.CORAL, 99));
        notifyDot.setVisibility(View.GONE);
        notifyDot.setContentDescription("Relances en retard");
        FrameLayout.LayoutParams dot = new FrameLayout.LayoutParams(dp(8), dp(8), Gravity.END | Gravity.TOP);
        dot.topMargin = dp(2);
        dot.rightMargin = dp(2);
        bell.addView(notifyDot, dot);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(36), dp(36));
        lp.leftMargin = dp(8);
        bell.setLayoutParams(lp);
        return bell;
    }

    private LinearLayout orgSelector() {
        LinearLayout pill = ui.row();
        pill.setBackground(ui.round(Color.WHITE, 999));
        pill.setElevation(dp(1));
        pill.setPadding(dp(10), dp(6), dp(8), dp(6));
        pill.setMinimumHeight(dp(34));
        ImageView building = new ImageView(this);
        building.setImageResource(R.drawable.ic_building);
        building.setColorFilter(UiKit.SAGE);
        building.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        pill.addView(building, new LinearLayout.LayoutParams(dp(16), dp(16)));
        TextView name = ui.label(organization == null || organization.isEmpty() ? "Société" : organization, 13, UiKit.PETROLEUM, true);
        name.setPadding(dp(6), 0, dp(4), 0);
        name.setMaxLines(1);
        name.setEllipsize(android.text.TextUtils.TruncateAt.END);
        name.setMaxWidth(dp(108));
        pill.addView(name);
        ImageView chevron = new ImageView(this);
        chevron.setImageResource(R.drawable.ic_chevron);
        chevron.setColorFilter(UiKit.PETROLEUM);
        chevron.setRotation(90);
        chevron.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        pill.addView(chevron, new LinearLayout.LayoutParams(dp(14), dp(14)));
        pill.setOnClickListener(v -> openMore());
        pill.setClickable(true);
        pill.setContentDescription("Changer de société, " + name.getText());
        return pill;
    }

    private void openMore() {
        if (layoutPreview) {
            new AlertDialog.Builder(this)
                .setTitle(organization)
                .setMessage("Le changement de société utilise le compte connecté.")
                .setPositiveButton("Fermer", null)
                .show();
            return;
        }
        if (busy) return;
        section = "settings";
        show();
    }

    private void openSection(String route, String scope) {
        if (busy) return;
        followupScope = scope == null ? "" : scope;
        section = route;
        offset = 0;
        query = "";
        show();
    }

    private void renderDashboard() {
        content.setPadding(0, 0, 0, dp(8));
        TextView hello = ui.label(greeting(), 22, UiKit.PETROLEUM, true);
        hello.setLetterSpacing(-0.03f);
        hello.setPadding(0, dp(8), 0, 0);
        hello.setMaxLines(1);
        hello.setEllipsize(android.text.TextUtils.TruncateAt.END);
        content.addView(hello);
        TextView sub = ui.label("Voici la synthèse de votre activité commerciale.", 13, UiKit.MUTED, false);
        sub.setPadding(0, 0, 0, 0);
        content.addView(sub);
        LinearLayout scan = ui.scanBanner(this::startScan);
        ui.margin(scan, 12, 0);
        content.addView(scan);
        if (layoutPreview) {
            try {
                String raw = getIntent() == null ? null : getIntent().getStringExtra("dashboard_json");
                paintDashboard(raw != null && !raw.isEmpty() ? new JSONObject(raw) : previewDashboard());
            } catch (Exception ignored) {}
            return;
        }
        run(() -> {
            JSONObject dash = api.request("GET", "/api/v1/dashboard", null);
            DashboardData.enrich(api, dash);
            return dash;
        }, this::paintDashboard);
    }

    private JSONObject previewDashboard() throws Exception {
        return new JSONObject()
            .put("counts", new JSONObject().put("contacts", 0).put("companies", 0).put("pending", 0).put("new_contacts", 0).put("new_companies", 0))
            .put("periods", new JSONObject()
                .put("late", new JSONObject().put("total", 0).put("items", new JSONArray()))
                .put("today", new JSONObject().put("total", 0).put("items", new JSONArray()))
                .put("upcoming", new JSONObject().put("total", 0).put("items", new JSONArray())))
            .put("followup_flow", new JSONObject().put("late", 0).put("upcoming", 0).put("completed", 0))
            .put("portfolio", new JSONObject().put("months", new JSONArray()).put("days", new JSONArray()))
            .put("contact_statuses", new JSONArray());
    }

    private void paintSuggestions(JSONObject suggestions) {
        JSONArray items = suggestions == null ? null : suggestions.optJSONArray("items");
        if (!layoutPreview) FollowupNotifier.deliver(this, items);
        if (items == null || items.length() == 0) return;
        TextView title = ui.label("À relancer aujourd’hui", 18, UiKit.PETROLEUM, true);
        title.setPadding(0, dp(16), 0, 0);
        content.addView(title);
        content.addView(ui.subtitle("Aucun message n’est envoyé sans votre validation."));
        int shown = Math.min(items.length(), 5);
        for (int i = 0; i < shown; i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            LinearLayout card = ui.column();
            card.setPadding(0, dp(10), 0, dp(6));
            card.addView(ui.label(item.optString("priority_label") + " · " + item.optString("contact_name"), 14, UiKit.SAGE, true));
            card.addView(ui.label(item.optString("reason"), 16, UiKit.PETROLEUM, false));
            String id = item.optString("contact_id");
            card.setOnClickListener(v -> {
                contactPane = 3;
                openContact(id, null);
            });
            content.addView(card);
        }
    }

    private void paintDashboard(JSONObject data) throws Exception {
        dashboardPayload = data;
        JSONObject counts = data.getJSONObject("counts");
        JSONObject periods = data.getJSONObject("periods");
        int late = periods.getJSONObject("late").optInt("total");
        int today = periods.optJSONObject("today") == null ? 0 : periods.getJSONObject("today").optInt("total");
        int upcoming = periods.optJSONObject("upcoming") == null ? 0 : periods.getJSONObject("upcoming").optInt("total");
        notifyLate = late;
        if (notifyDot != null) notifyDot.setVisibility(late > 0 ? View.VISIBLE : View.GONE);
        if (notifyButton != null) {
            notifyButton.setContentDescription(late > 0
                ? "Notifications, " + late + (late > 1 ? " relances en retard" : " relance en retard")
                : "Notifications");
        }

        LinearLayout metrics = ui.row();
        metrics.setPadding(0, dp(12), 0, 0);
        int freshContacts = counts.optInt("new_contacts");
        int freshCompanies = counts.optInt("new_companies");
        String[] values = {counts.optString("contacts", "0"), counts.optString("companies", "0"), counts.optString("pending", "0")};
        String[] names = {"Contacts", "Entreprises", "Relances"};
        String[] extras = {
            freshContacts > 0 ? "↗ +" + freshContacts : "",
            freshCompanies > 0 ? "↗ +" + freshCompanies : "",
            late > 0 ? late + " en retard" : ""
        };
        int[] extraColors = {UiKit.SAGE, UiKit.SAGE, UiKit.CORAL};
        String[] routes = {"contacts", "companies", "followups"};
        int[] icons = {R.drawable.ic_people, R.drawable.ic_building, R.drawable.ic_bell};
        int[] tones = {UiKit.BLUE, UiKit.TURQUOISE, UiKit.CORAL};
        for (int i = 0; i < names.length; i++) {
            final String route = routes[i];
            LinearLayout card = ui.kpiTile(icons[i], tones[i], values[i], names[i], extras[i], extraColors[i], () -> openSection(route, ""));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 1);
            if (i > 0) lp.leftMargin = dp(8);
            metrics.addView(card, lp);
        }
        content.addView(metrics);
        paintSuggestions(data.optJSONObject("suggestions"));

        View priority = priorityStrip(periods, late, today, upcoming);
        if (priority != null) content.addView(priority);
        portfolioHost = portfolioCard(data);
        content.addView(portfolioHost);
        content.addView(lowerCharts(data));
    }

    private View priorityStrip(JSONObject periods, int late, int today, int upcoming) {
        int soon = today + upcoming;
        if (late <= 0 && soon <= 0) return null;
        LinearLayout card = ui.surfaceCard();
        card.setPadding(0, 0, 0, 0);
        card.setElevation(dp(1));
        LinearLayout row = ui.row();
        row.setGravity(Gravity.TOP);
        if (late > 0) row.addView(priorityCell(periods.optJSONObject("late"), late, true), new LinearLayout.LayoutParams(0, -2, 1));
        if (late > 0 && soon > 0) {
            View rule = new View(this);
            rule.setBackgroundColor(Color.rgb(226, 232, 230));
            LinearLayout.LayoutParams ruleLp = new LinearLayout.LayoutParams(dp(1), dp(56));
            ruleLp.gravity = Gravity.CENTER_VERTICAL;
            row.addView(rule, ruleLp);
        }
        if (soon > 0) {
            JSONObject source = today > 0 ? periods.optJSONObject("today") : periods.optJSONObject("upcoming");
            row.addView(priorityCell(source, soon, false), new LinearLayout.LayoutParams(0, -2, 1));
        }
        card.addView(row);
        ui.margin(card, 12, 0);
        return card;
    }

    private LinearLayout priorityCell(JSONObject page, int total, boolean urgent) {
        JSONArray items = page == null ? null : page.optJSONArray("items");
        JSONObject first = items == null || items.length() == 0 ? null : items.optJSONObject(0);
        String subject = first == null ? "" : first.optString("subject");
        String title = urgent ? "Actions prioritaires" : "Prochaines relances";
        String primary = !subject.isEmpty()
            ? subject
            : total + (urgent
                ? (total > 1 ? " relances en retard" : " relance en retard")
                : (total > 1 ? " relances à venir" : " relance à venir"));
        String secondary = subject.isEmpty() ? "" : (urgent
            ? (total > 1 ? total + " en retard" : "En retard")
            : total + (total > 1 ? " à venir" : " à venir"));
        String scope = urgent ? "late" : "soon";
        LinearLayout cell = ui.column();
        cell.setPadding(dp(12), dp(10), dp(10), dp(10));
        LinearLayout head = ui.row();
        ImageView mark = new ImageView(this);
        mark.setImageResource(urgent ? R.drawable.ic_target : R.drawable.ic_calendar);
        mark.setColorFilter(urgent ? UiKit.CORAL : UiKit.SAGE);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        head.addView(mark, new LinearLayout.LayoutParams(dp(16), dp(16)));
        TextView heading = ui.label(title, 12, UiKit.PETROLEUM, true);
        heading.setPadding(dp(6), 0, 0, 0);
        heading.setMaxLines(1);
        heading.setEllipsize(android.text.TextUtils.TruncateAt.END);
        head.addView(heading, new LinearLayout.LayoutParams(0, -2, 1));
        cell.addView(head);
        TextView line = ui.label(primary, 13, UiKit.MUTED, false);
        line.setPadding(0, dp(6), 0, 0);
        line.setMaxLines(2);
        line.setEllipsize(android.text.TextUtils.TruncateAt.END);
        cell.addView(line);
        if (!secondary.isEmpty()) {
            TextView more = ui.label(secondary, 12, urgent ? UiKit.CORAL : UiKit.SAGE, true);
            more.setPadding(0, dp(2), 0, 0);
            more.setMaxLines(1);
            cell.addView(more);
        }
        cell.setOnClickListener(v -> openSection("followups", scope));
        cell.setClickable(true);
        cell.setContentDescription(title + ", " + primary);
        return cell;
    }

    private View portfolioCard(JSONObject data) throws Exception {
        LinearLayout card = ui.surfaceCard();
        card.setElevation(dp(1));
        chartHeading(card, "Évolution du portefeuille", "Contacts et entreprises créés");
        JSONObject portfolio = data.optJSONObject("portfolio");
        if (portfolio == null) {
            card.addView(hint(data.optBoolean("portfolio_skipped")
                ? "Trop de fiches pour calculer l’historique sur l’appareil."
                : "L’historique des créations n’est pas disponible."));
            ui.margin(card, 12, 0);
            return card;
        }
        LinearLayout chips = ui.row();
        chips.setGravity(Gravity.END);
        chips.addView(windowChip("30d", "30 j"));
        chips.addView(windowChip("3m", "3 mois"));
        chips.addView(windowChip("6m", "6 mois"));
        chips.addView(windowChip("12m", "12 mois"));
        card.addView(chips);
        JSONArray rows = portfolio.optJSONArray("30d".equals(chartWindow) ? "days" : "months");
        int count = switch (chartWindow) {
            case "30d" -> 30;
            case "3m" -> 3;
            case "12m" -> 12;
            default -> 6;
        };
        BoardCharts.Window window = BoardCharts.slice(rows == null ? new JSONArray() : rows, count);
        boolean any = false;
        for (int value : window.contacts) if (value > 0) any = true;
        for (int value : window.companies) if (value > 0) any = true;
        if (!any) {
            card.addView(hint("Aucune création sur cette période."));
            ui.margin(card, 12, 0);
            return card;
        }
        LinearLayout plot = ui.row();
        plot.setGravity(Gravity.CENTER_VERTICAL);
        BoardCharts.LineChart chart = new BoardCharts.LineChart(this);
        chart.setSeries(window.buckets, window.contacts, window.companies);
        plot.addView(chart, new LinearLayout.LayoutParams(0, dp(168), 1));
        LinearLayout legend = ui.column();
        legend.setMinimumWidth(dp(96));
        legend.setPadding(dp(8), 0, 0, 0);
        legend.addView(seriesLegend(UiKit.SAGE, "Contacts", window.contactSum, window.contactDelta));
        legend.addView(seriesLegend(UiKit.ORANGE, "Entreprises", window.companySum, window.companyDelta));
        plot.addView(legend);
        card.addView(plot);
        ui.margin(card, 12, 0);
        return card;
    }

    private TextView windowChip(String id, String label) {
        boolean on = id.equals(chartWindow);
        TextView chip = ui.label(label, 12, on ? UiKit.SAGE : UiKit.MUTED, on);
        chip.setBackground(ui.round(on ? UiKit.MIST : Color.TRANSPARENT, 999));
        chip.setPadding(dp(8), dp(4), dp(8), dp(4));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
        lp.leftMargin = dp(2);
        chip.setLayoutParams(lp);
        chip.setOnClickListener(v -> selectWindow(id));
        chip.setContentDescription(label);
        return chip;
    }

    private void selectWindow(String window) {
        if (window.equals(chartWindow) || dashboardPayload == null || content == null || portfolioHost == null) return;
        chartWindow = window;
        int index = content.indexOfChild(portfolioHost);
        if (index < 0) return;
        try {
            View next = portfolioCard(dashboardPayload);
            content.removeView(portfolioHost);
            content.addView(next, index);
            portfolioHost = next;
        } catch (Exception e) {
            showStatus(e.getMessage(), UiKit.DANGER);
        }
    }

    private LinearLayout seriesLegend(int color, String name, int total, String delta) {
        LinearLayout box = ui.column();
        box.setPadding(0, dp(2), 0, dp(6));
        LinearLayout head = ui.row();
        View dot = new View(this);
        dot.setBackground(ui.round(color, 99));
        head.addView(dot, new LinearLayout.LayoutParams(dp(8), dp(8)));
        TextView caption = ui.label(name, 12, UiKit.MUTED, false);
        caption.setPadding(dp(6), 0, 0, 0);
        head.addView(caption);
        box.addView(head);
        TextView value = ui.label(String.valueOf(total), 18, UiKit.PETROLEUM, true);
        value.setPadding(0, 0, 0, 0);
        box.addView(value);
        if (delta != null && !delta.isEmpty()) {
            int tone = delta.startsWith("↘") ? UiKit.CORAL : delta.startsWith("0") ? UiKit.MUTED : UiKit.SAGE;
            TextView change = ui.label(delta, 11, tone, true);
            change.setPadding(0, 0, 0, 0);
            box.addView(change);
        }
        box.setContentDescription(name + ", " + total + (delta == null ? "" : ", " + delta));
        return box;
    }

    private View lowerCharts(JSONObject data) throws Exception {
        float widthDp = getResources().getDisplayMetrics().widthPixels / getResources().getDisplayMetrics().density;
        boolean side = widthDp >= 360f;
        LinearLayout wrap = side ? ui.row() : ui.column();
        wrap.setGravity(Gravity.TOP);
        LinearLayout bars = followupChart(data);
        LinearLayout donut = statusChart(data);
        if (side) {
            bars.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
            LinearLayout.LayoutParams right = new LinearLayout.LayoutParams(0, -2, 1);
            right.leftMargin = dp(8);
            donut.setLayoutParams(right);
        } else ui.margin(donut, 8, 0);
        wrap.addView(bars);
        wrap.addView(donut);
        ui.margin(wrap, 12, 0);
        return wrap;
    }

    private LinearLayout followupChart(JSONObject data) {
        LinearLayout card = ui.surfaceCard();
        card.setPadding(dp(12), dp(12), dp(12), dp(8));
        card.setElevation(dp(1));
        chartHeading(card, "Relances commerciales", "État des relances");
        JSONObject flow = data.optJSONObject("followup_flow");
        if (flow == null) {
            card.addView(hint("Les totaux de relances ne sont pas disponibles."));
            return card;
        }
        int late = flow.optInt("late");
        int soon = flow.optInt("upcoming");
        int done = flow.optInt("completed");
        if (late + soon + done == 0) {
            card.addView(hint("Aucune relance enregistrée."));
            return card;
        }
        BoardCharts.Bars bars = new BoardCharts.Bars(this);
        bars.setValues(
            new String[]{"En retard", "À venir", "Terminées"},
            new int[]{late, soon, done},
            new int[]{UiKit.CORAL, UiKit.SAGE, UiKit.PETROLEUM});
        bars.setOnBucket(index -> {
            if (busy) return;
            String scope = switch (index) {
                case 0 -> "late";
                case 1 -> "soon";
                default -> "completed";
            };
            openSection("followups", scope);
        });
        card.addView(bars, new LinearLayout.LayoutParams(-1, dp(176)));
        return card;
    }

    private LinearLayout statusChart(JSONObject data) throws Exception {
        LinearLayout card = ui.surfaceCard();
        card.setPadding(dp(12), dp(12), dp(12), dp(8));
        card.setElevation(dp(1));
        chartHeading(card, "Répartition des contacts", "Par statut commercial");
        if (data.optBoolean("statuses_skipped")) {
            card.addView(hint("Répartition indisponible pour ce volume."));
            return card;
        }
        JSONArray statuses = data.optJSONArray("contact_statuses");
        if (statuses == null) {
            card.addView(hint("La répartition par statut n’est pas disponible."));
            return card;
        }
        if (statuses.length() == 0) {
            card.addView(hint("Aucun statut commercial renseigné."));
            return card;
        }
        String[] names = new String[statuses.length()];
        int[] counts = new int[statuses.length()];
        for (int i = 0; i < statuses.length(); i++) {
            JSONObject row = statuses.getJSONObject(i);
            names[i] = row.optString("name");
            counts[i] = row.optInt("count");
        }
        BoardCharts.Donut donut = new BoardCharts.Donut(this);
        donut.setSlices(names, counts);
        card.addView(donut, new LinearLayout.LayoutParams(-1, -2));
        return card;
    }

    private void chartHeading(LinearLayout card, String title, String subtitle) {
        TextView heading = ui.label(title, 15, UiKit.PETROLEUM, true);
        heading.setPadding(0, 0, 0, 0);
        card.addView(heading);
        TextView detail = ui.label(subtitle, 12, UiKit.MUTED, false);
        detail.setPadding(0, dp(1), 0, dp(6));
        card.addView(detail);
    }

    private TextView hint(String message) {
        TextView text = ui.label(message, 13, UiKit.MUTED, false);
        text.setPadding(0, dp(8), 0, dp(8));
        return text;
    }

    private void renderDirectory() {
        boolean contacts = section.equals("contacts");
        LinearLayout titleRow = ui.row();
        titleRow.setPadding(0, dp(16), 0, 0);
        int accent = contacts ? UiKit.BLUE : UiKit.TURQUOISE;
        TextView heading = ui.pageTitle(contacts ? "Contacts" : "Entreprises");
        heading.setTextColor(accent);
        heading.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        titleRow.addView(heading);
        ImageButton add = ui.squareAction(R.drawable.ic_plus, UiKit.wash(accent), accent, contacts ? "Nouveau contact" : "Nouvelle entreprise", () -> openCreate());
        LinearLayout.LayoutParams addLp = (LinearLayout.LayoutParams) add.getLayoutParams();
        addLp.rightMargin = dp(8);
        titleRow.addView(add);
        titleRow.addView(ui.squareAction(R.drawable.ic_scan_white, UiKit.ORANGE, Color.WHITE, contacts ? "Scanner une carte de visite" : "Scanner une fiche entreprise", this::startScan));
        chrome.addView(titleRow);

        chrome.addView(ui.directorySearch(
            contacts ? "Rechercher un contact…" : "Rechercher une entreprise…",
            query,
            this::onDirectoryQuery
        ));

        LinearLayout meta = ui.row();
        meta.setPadding(dp(4), dp(8), dp(4), dp(8));
        directoryCount = ui.subtitle("");
        directoryCount.setPadding(0, 0, 0, 0);
        directoryCount.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        meta.addView(directoryCount);
        directoryProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleSmall);
        directoryProgress.setVisibility(View.GONE);
        meta.addView(directoryProgress);
        chrome.addView(meta);

        directoryList = ui.column();
        content.addView(directoryList);
        fetchDirectory(true);
    }

    private void openCreate() {
        long now = android.os.SystemClock.elapsedRealtime();
        if (busy || now - lastCreateTap < 700) return;
        lastCreateTap = now;
        edit(new JSONObject());
    }

    private void onDirectoryQuery(String raw) {
        String next = raw == null ? "" : raw.trim();
        if (next.equals(query)) return;
        query = next;
        offset = 0;
        uiHandler.removeCallbacks(directorySearchTask);
        uiHandler.postDelayed(directorySearchTask, 280);
    }

    private void fetchDirectory(boolean replace) {
        if (layoutPreview) {
            try {
                boolean contacts = "contacts".equals(section);
                String name = contacts ? "Amina Ben Ali" : "CarboScan";
                String extra = contacts ? "Directrice" : "La Soukra";
                String needle = query == null ? "" : query.toLowerCase(java.util.Locale.ROOT);
                boolean match = needle.isEmpty()
                    || name.toLowerCase(java.util.Locale.ROOT).contains(needle)
                    || extra.toLowerCase(java.util.Locale.ROOT).contains(needle);
                JSONArray items = new JSONArray();
                if (match) {
                    JSONObject item = new JSONObject().put("id", "preview").put("name", name);
                    if (contacts) item.put("job_title", extra);
                    else item.put("city", extra);
                    items.put(item);
                }
                paintDirectory(new JSONObject().put("total", items.length()).put("items", items), section, true);
            } catch (Exception ignored) {}
            return;
        }
        final int ticket = ++directoryTicket;
        final int gen = generation;
        final String route = section;
        final String q = query;
        final int off = replace ? 0 : offset;
        if (replace) offset = 0;
        directoryLoading = true;
        if (directoryProgress != null) directoryProgress.setVisibility(View.VISIBLE);
        if (replace && directoryCount != null && directoryList != null && directoryList.getChildCount() == 0) {
            directoryCount.setText("Chargement…");
        }
        worker.execute(() -> {
            JSONObject data = null;
            Exception failure = null;
            try {
                data = api.request("GET", "/api/v1/" + route + "?limit=25&offset=" + off + "&q=" + URLEncoder.encode(q, "UTF-8"), null);
            } catch (Exception e) { failure = e; }
            final JSONObject payload = data;
            final Exception error = failure;
            runOnUiThread(() -> {
                if (isDestroyed() || gen != generation || ticket != directoryTicket) return;
                directoryLoading = false;
                if (directoryProgress != null) directoryProgress.setVisibility(View.GONE);
                if (error != null) {
                    if (error instanceof ApiClient.Failure && ((ApiClient.Failure) error).status == 401 && !api.token.isEmpty()) {
                        sessions.clear();
                        api.token = "";
                        showLogin(null);
                        return;
                    }
                    showStatus(error instanceof java.io.IOException
                        ? "Serveur inaccessible. Vérifiez la connexion, puis réessayez."
                        : error.getMessage(), UiKit.DANGER);
                    if (replace && directoryCount != null) directoryCount.setText("");
                    return;
                }
                try { paintDirectory(payload, route, replace); }
                catch (Exception e) { showStatus(e.getMessage(), UiKit.DANGER); }
            });
        });
    }

    private void paintDirectory(JSONObject data, String route, boolean replace) throws Exception {
        if (directoryList == null || directoryCount == null) return;
        boolean contacts = route.equals("contacts");
        if (replace) directoryList.removeAllViews();
        else {
            View previous = directoryList.findViewWithTag("more");
            if (previous != null) directoryList.removeView(previous);
        }
        JSONArray items = data.getJSONArray("items");
        int total = data.getInt("total");
        String noun = contacts
            ? (total > 1 || total == 0 ? "contacts" : "contact")
            : (total > 1 || total == 0 ? "entreprises" : "entreprise");
        directoryCount.setText(total + " " + noun);
        directoryCount.setTextColor(contacts ? UiKit.BLUE : UiKit.TURQUOISE);
        if (items.length() == 0 && replace) {
            LinearLayout empty = ui.column();
            empty.setGravity(Gravity.CENTER_HORIZONTAL);
            empty.setPadding(dp(12), dp(36), dp(12), dp(8));
            boolean searching = query != null && !query.isEmpty();
            TextView message = ui.label(searching
                ? (contacts ? "Aucun contact trouvé" : "Aucune entreprise trouvée")
                : (contacts ? "Aucun contact pour l’instant." : "Aucune entreprise pour l’instant."), 15, UiKit.MUTED, false);
            message.setGravity(Gravity.CENTER);
            empty.addView(message);
            if (!searching) {
                TextView hint = ui.subtitle(contacts
                    ? "Créez une fiche avec + ou scannez une carte de visite."
                    : "Créez une fiche avec + ou scannez un document.");
                hint.setGravity(Gravity.CENTER);
                hint.setPadding(0, dp(6), 0, dp(14));
                empty.addView(hint);
                LinearLayout actions = ui.row();
                actions.setGravity(Gravity.CENTER);
                actions.addView(ui.chip("Créer", false, this::openCreate));
                actions.addView(ui.chip("Scanner", true, this::startScan));
                empty.addView(actions);
            }
            directoryList.addView(empty);
            return;
        }
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            String city = clean(item, "city");
            String detail = contacts
                ? join(" · ", clean(item, "job_title"), clean(item, "phone"))
                : city;
            LinearLayout card = ui.entityCard(
                contacts ? R.drawable.ic_person : R.drawable.ic_building,
                contacts ? UiKit.BLUE : UiKit.TURQUOISE,
                item.optString("name"),
                detail,
                !contacts && !city.trim().isEmpty(),
                () -> detail(item)
            );
            ui.margin(card, i == 0 && replace ? 2 : 8, 0);
            directoryList.addView(card);
        }
        int shown = offset + items.length();
        if (shown < total) {
            TextView more = ui.label("Afficher la suite", 14, contacts ? UiKit.BLUE : UiKit.TURQUOISE, true);
            more.setGravity(Gravity.CENTER);
            more.setPadding(0, dp(14), 0, dp(8));
            more.setTag("more");
            more.setOnClickListener(v -> {
                if (directoryLoading) return;
                offset = shown;
                fetchDirectory(false);
            });
            directoryList.addView(more);
        }
    }

    private void renderFollowups() {
        if (layoutPreview) {
            try {
                followupCard(new JSONObject().put("id", "preview-late").put("subject", "Relancer Amina").put("status", "pending").put("due_at", "2026-11-01T09:00:00Z"), 2);
                followupCard(new JSONObject().put("id", "preview-today").put("subject", "Appel CarboScan").put("status", "pending").put("due_at", java.time.OffsetDateTime.now().toString()), 0);
            } catch (Exception ignored) {}
            return;
        }
        if ("soon".equals(followupScope)) {
            renderSoonFollowups();
            return;
        }
        String scopeQuery = switch (followupScope) {
            case "completed" -> "&status=completed";
            case "late", "today", "upcoming" -> "&status=pending&scope=" + followupScope;
            default -> "";
        };
        run(() -> api.request("GET", "/api/v1/followups?limit=25&offset=" + offset + "&q=" + URLEncoder.encode(query, "UTF-8") + scopeQuery, null), data -> {
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

    private void renderSoonFollowups() {
        run(() -> {
            String q = URLEncoder.encode(query, "UTF-8");
            JSONObject today = api.request("GET", "/api/v1/followups?limit=25&offset=0&status=pending&scope=today&q=" + q, null);
            JSONObject upcoming = api.request("GET", "/api/v1/followups?limit=25&offset=" + offset + "&status=pending&scope=upcoming&q=" + q, null);
            JSONArray items = new JSONArray();
            if (offset == 0) {
                JSONArray todays = today.getJSONArray("items");
                for (int i = 0; i < todays.length(); i++) items.put(todays.get(i));
            }
            JSONArray next = upcoming.getJSONArray("items");
            for (int i = 0; i < next.length(); i++) items.put(next.get(i));
            return new JSONObject()
                .put("items", items)
                .put("total", today.getInt("total") + upcoming.getInt("total"))
                .put("upcoming_shown", next.length())
                .put("upcoming_total", upcoming.getInt("total"));
        }, data -> {
            JSONArray items = data.getJSONArray("items");
            int total = data.getInt("total");
            content.addView(ui.subtitle(total == 0 ? "Aucune relance à venir" : total + (total > 1 ? " relances à venir" : " relance à venir")));
            if (total == 0) {
                LinearLayout empty = ui.surfaceCard();
                empty.addView(ui.emptyState("Aucune relance à venir."));
                ui.margin(empty, 8, 0);
                content.addView(empty);
                return;
            }
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                followupCard(item, dueTone(clean(item, "due_at")));
            }
            if (offset > 0) content.addView(ui.secondary("Page précédente", () -> {
                if (busy) return;
                offset = Math.max(0, offset - 25);
                show();
            }));
            if (offset + data.optInt("upcoming_shown") < data.optInt("upcoming_total")) content.addView(ui.secondary("Page suivante", () -> {
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
        int stripe = tone == 0 ? UiKit.TURQUOISE : tone == 2 ? UiKit.CORAL : tone == 1 ? UiKit.ORANGE : UiKit.MUTED;
        LinearLayout shell = ui.column();
        ui.margin(shell, 8, 0);
        shell.setBackground(ui.round(stripe, 16));
        shell.setPadding(dp(5), 0, 0, 0);
        shell.setElevation(dp(2));
        LinearLayout card = ui.column();
        card.setBackground(ui.round(UiKit.SURFACE, 16));
        card.setPadding(dp(12), dp(12), dp(12), dp(8));
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
        shell.addView(card, new LinearLayout.LayoutParams(-1, -2));
        content.addView(shell);
    }

    private int followupAccent() {
        return switch (followupScope) {
            case "late" -> UiKit.CORAL;
            case "today" -> UiKit.TURQUOISE;
            case "soon", "upcoming", "completed" -> UiKit.SAGE;
            default -> UiKit.ORANGE;
        };
    }

    private boolean canWrite() {
        return !"reader".equals(membershipRole) && !"pending_deletion".equals(closureStatus);
    }

    private String memberName(String userId) {
        if (userId == null || userId.isEmpty() || members == null) return "";
        for (int i = 0; i < members.length(); i++) {
            JSONObject member = members.optJSONObject(i);
            if (member != null && userId.equals(member.optString("id"))) return member.optString("name");
        }
        return "";
    }

    private void openContact(String id, JSONObject seed) {
        if (id == null || id.isEmpty()) return;
        contactId = id;
        contactSeed = seed;
        section = "contact";
        show();
    }

    private void closeContact() {
        contactScreen = null;
        section = "contacts";
        show();
    }

    private void renderContact() {
        if (contactId == null || contactId.isEmpty()) {
            section = "contacts";
            renderDirectory();
            return;
        }
        final int ticket = generation;
        contactScreen = new ContactRecordScreen(this, ui, api, worker, new ContactRecordScreen.Listener() {
            @Override public boolean alive() { return !isDestroyed() && ticket == generation && "contact".equals(section); }
            @Override public boolean canWrite() { return MainActivity.this.canWrite(); }
            @Override public String memberName(String userId) { return MainActivity.this.memberName(userId); }
            @Override public void onCompany(String companyId) { openCompany(companyId); }
            @Override public void onPlanFollowup(String id) {
                try { editFollowup(new JSONObject().put("contact_id", id)); }
                catch (Exception error) { showStatus(error.getMessage(), UiKit.DANGER); }
            }
            @Override public void onEditFollowup(JSONObject followup) { editFollowup(followup); }
            @Override public void onPane(int pane) { contactPane = pane; }
            @Override public void onClose() { closeContact(); }
            @Override public void onSessionExpired() {
                sessions.clear();
                api.token = "";
                showLogin(null);
            }
            @Override public void onStatus(String message, int color) { showStatus(message, color); }
        }, contactId, contactSeed, contactPane, layoutPreview);
        contactScreen.attach(chrome, content);
    }

    private void openCompany(String companyId) {
        if (busy || companyId == null || companyId.isEmpty() || layoutPreview) return;
        run(() -> api.request("GET", "/api/v1/companies/" + companyId, null), company -> showRecord("companies", company));
    }

    private void detail(JSONObject item) {
        if (busy) return;
        if ("contacts".equals(section)) {
            contactPane = 0;
            openContact(item.optString("id"), item);
            return;
        }
        String route = section;
        if (layoutPreview) {
            showRecord(route, item);
            return;
        }
        run(() -> api.request("GET", "/api/v1/" + route + "/" + item.getString("id"), null), this::showRecordBound);
    }

    private void showRecordBound(JSONObject record) {
        showRecord(section, record);
    }

    private static String fieldLabel(String key) {
        return switch (key) {
            case "job_title" -> "Fonction";
            case "department" -> "Service";
            case "phone" -> "Téléphone";
            case "phone_work" -> "Téléphone pro";
            case "whatsapp" -> "WhatsApp";
            case "source" -> "Source";
            case "status" -> "Statut";
            case "sector" -> "Secteur";
            case "relation_type" -> "Relation";
            case "city" -> "Ville";
            case "country" -> "Pays";
            case "email" -> "E-mail";
            case "website" -> "Site web";
            case "company_size" -> "Taille";
            case "description" -> "Description";
            case "address" -> "Adresse";
            case "linkedin" -> "LinkedIn";
            case "socials" -> "Autres réseaux";
            default -> key.replace('_', ' ');
        };
    }

    private void showRecord(String route, JSONObject record) {
        try {
            LinearLayout body = ui.column();
            body.setPadding(dp(8), 0, dp(8), 0);
            TextView heading = ui.title(record.optString("name"));
            heading.setTextColor(route.equals("contacts") ? UiKit.BLUE : UiKit.TURQUOISE);
            body.addView(heading);
            String[] keys = route.equals("contacts")
                ? new String[]{"job_title", "department", "phone", "phone_work", "whatsapp", "source", "status"}
                : new String[]{"sector", "relation_type", "city", "country", "phone", "email", "website", "status", "source", "company_size", "description", "address", "linkedin", "socials"};
            for (String key : keys) {
                String value = clean(record, key);
                if (value.trim().isEmpty()) continue;
                body.addView(ui.caption(fieldLabel(key)));
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
        } catch (Exception e) {
            showStatus(e.getMessage(), UiKit.DANGER);
        }
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
    private void renderSettings() {
        if (layoutPreview) {
            content.addView(ui.subtitle("Les paramètres utilisent le compte connecté."));
            return;
        }
        new SettingsScreen(this, ui, api, worker, () -> generation, () -> {
            sessions.clear();
            api.token = "";
            showLogin(null);
        }, () -> {
            section = "dashboard";
            offset = 0;
            query = "";
            loadIdentity();
        }).load(content);
    }
}
