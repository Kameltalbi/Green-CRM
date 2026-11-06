package com.ciblix.crm;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.text.InputType;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.OffsetDateTime;
import java.util.concurrent.ExecutorService;
import java.util.function.IntSupplier;

/** Paramètres du compte, des espaces et des collaborateurs. Chaque action appelle l’API. */
final class SettingsScreen {
    private static final String[] ROLE_CODES = {"member", "admin", "reader"};
    private static final String[] ROLE_LABELS = {"Commercial", "Administrateur", "Lecture seule"};

    private final Activity activity;
    private final UiKit ui;
    private final ApiClient api;
    private final ExecutorService worker;
    private final IntSupplier generation;
    private final Runnable signedOut;
    private final Runnable workspaceChanged;
    private LinearLayout content;
    private TextView banner;
    private boolean working;
    private int stamp;

    SettingsScreen(Activity activity, UiKit ui, ApiClient api, ExecutorService worker, IntSupplier generation, Runnable signedOut, Runnable workspaceChanged) {
        this.activity = activity;
        this.ui = ui;
        this.api = api;
        this.worker = worker;
        this.generation = generation;
        this.signedOut = signedOut;
        this.workspaceChanged = workspaceChanged;
    }

    void load(LinearLayout content) {
        this.content = content;
        stamp = generation.getAsInt();
        content.removeAllViews();
        content.addView(ui.subtitle("Chargement des paramètres…"));
        worker.execute(() -> {
            try {
                JSONObject me = api.request("GET", "/api/v1/me", null);
                JSONArray invitations = new JSONArray();
                if ("admin".equals(me.getJSONObject("organization").optString("role"))) {
                    JSONObject payload = api.request("GET", "/api/v1/invitations", null);
                    JSONArray items = payload.optJSONArray("items");
                    if (items != null) invitations = items;
                }
                JSONArray pending = invitations;
                activity.runOnUiThread(() -> {
                    if (!current()) return;
                    paint(me, pending);
                });
            } catch (Exception error) {
                activity.runOnUiThread(() -> {
                    if (activity.isDestroyed() || stamp != generation.getAsInt()) return;
                    if (unauthorized(error)) { signedOut.run(); return; }
                    content.removeAllViews();
                    content.addView(ui.subtitle(error.getMessage()));
                    content.addView(ui.secondary("Réessayer", this::reload));
                });
            }
        });
    }

    private void paint(JSONObject me, JSONArray invitations) {
        content.removeAllViews();
        banner = ui.subtitle("");
        banner.setVisibility(View.GONE);
        content.addView(banner);
        try {
            JSONObject user = me.getJSONObject("user");
            JSONObject organization = me.getJSONObject("organization");
            JSONArray organizations = me.getJSONArray("organizations");
            JSONArray members = me.getJSONArray("members");
            boolean admin = "admin".equals(organization.optString("role"));
            content.addView(accountCard(user, organization));
            content.addView(workspaceCard(organization, organizations));
            if (admin) content.addView(teamCard(user, organization, members, invitations));
            content.addView(privacyCard());
            content.addView(ui.primary("Se déconnecter", () -> call("POST", "/api/v1/auth/logout", new JSONObject(), signedOut)));
        } catch (Exception error) {
            content.addView(ui.subtitle(error.getMessage()));
        }
    }

    private LinearLayout accountCard(JSONObject user, JSONObject organization) throws Exception {
        LinearLayout card = section("Mon compte", "Identité utilisée dans l’espace ouvert.");
        card.addView(ui.label(user.optString("name", "Compte"), 18, UiKit.PETROLEUM, true));
        card.addView(ui.subtitle(user.getString("email")));
        TextView role = ui.statusPill(roleLabel(organization.optString("role")), 0);
        LinearLayout.LayoutParams pill = new LinearLayout.LayoutParams(-2, -2);
        pill.topMargin = ui.dp(8);
        role.setLayoutParams(pill);
        card.addView(role);
        return card;
    }

    private LinearLayout workspaceCard(JSONObject current, JSONArray organizations) throws Exception {
        LinearLayout card = section("Espace de travail", "Chaque espace conserve ses propres contacts, entreprises et relances.");
        for (int i = 0; i < organizations.length(); i++) {
            JSONObject org = organizations.getJSONObject(i);
            boolean opened = org.getString("id").equals(current.getString("id"));
            LinearLayout row = ui.column();
            row.setPadding(0, ui.dp(10), 0, ui.dp(10));
            row.addView(ui.label(org.getString("name"), 16, UiKit.PETROLEUM, true));
            row.addView(ui.subtitle(roleLabel(org.optString("role")) + (opened ? " · Espace actuel" : "")));
            if (!opened) {
                row.addView(ui.secondary("Ouvrir cet espace", () -> {
                    try {
                        call("POST", "/api/v1/organizations/switch", new JSONObject().put("organization_id", org.getString("id")), workspaceChanged);
                    } catch (Exception error) {
                        showError(error.getMessage());
                    }
                }));
            }
            card.addView(row);
        }
        return card;
    }

    private LinearLayout teamCard(JSONObject user, JSONObject organization, JSONArray members, JSONArray invitations) throws Exception {
        LinearLayout card = section("Équipe et collaborateurs", "L’invitation ouvre uniquement « " + organization.getString("name") + " ». Un même compte peut ensuite appartenir à d’autres espaces, sans mélange des données.");
        EditText email = ui.field(card, "E-mail du collaborateur", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        card.addView(ui.caption("Rôle"));
        Spinner roles = new Spinner(activity);
        roles.setAdapter(new ArrayAdapter<>(activity, android.R.layout.simple_spinner_dropdown_item, ROLE_LABELS));
        roles.setContentDescription("Rôle");
        card.addView(roles);
        card.addView(ui.vivid("Envoyer l’invitation", UiKit.SAGE, () -> {
            String address = email.getText().toString().trim();
            if (address.isEmpty()) { showError("Indiquez l’adresse e-mail du collaborateur."); return; }
            try {
                JSONObject body = new JSONObject().put("email", address).put("role", ROLE_CODES[roles.getSelectedItemPosition()]);
                call("POST", "/api/v1/invitations", body, this::reload);
            } catch (Exception error) {
                showError(error.getMessage());
            }
        }));

        card.addView(heading("Collaborateurs actifs"));
        int activeCount = 0;
        for (int i = 0; i < members.length(); i++) {
            JSONObject member = members.getJSONObject(i);
            if (!member.optBoolean("active")) continue;
            activeCount++;
            card.addView(memberRow(user.getString("id"), member, members));
        }
        if (activeCount == 0) card.addView(ui.subtitle("Aucun collaborateur actif."));

        card.addView(heading("Invitations en attente"));
        int pendingCount = 0;
        for (int i = 0; i < invitations.length(); i++) {
            JSONObject invite = invitations.getJSONObject(i);
            if (!invite.isNull("accepted_at") || !invite.isNull("revoked_at")) continue;
            pendingCount++;
            card.addView(inviteRow(invite));
        }
        if (pendingCount == 0) card.addView(ui.subtitle("Aucune invitation en attente."));
        return card;
    }

    private LinearLayout memberRow(String selfId, JSONObject member, JSONArray members) throws Exception {
        LinearLayout row = ui.column();
        row.setPadding(0, ui.dp(8), 0, ui.dp(4));
        String name = member.optString("name");
        boolean self = selfId.equals(member.getString("id"));
        row.addView(ui.label(name + (self ? " (vous)" : ""), 16, UiKit.PETROLEUM, true));
        row.addView(ui.subtitle(member.optString("email") + " · " + roleLabel(member.optString("role"))));
        LinearLayout actions = ui.row();
        actions.addView(action("Modifier le rôle", () -> chooseRole(member)));
        if (!self) actions.addView(action("Retirer", () -> confirmRemoval(member, members)));
        row.addView(actions);
        return row;
    }

    private LinearLayout inviteRow(JSONObject invite) throws Exception {
        LinearLayout row = ui.column();
        row.setPadding(0, ui.dp(8), 0, ui.dp(4));
        boolean expired = expired(invite.optString("expires_at"));
        row.addView(ui.label(invite.getString("email"), 16, UiKit.PETROLEUM, true));
        row.addView(ui.subtitle(roleLabel(invite.optString("role")) + (expired ? " · Expirée" : " · En attente")));
        LinearLayout actions = ui.row();
        actions.addView(action("Renvoyer", () -> {
            try {
                JSONObject body = new JSONObject().put("email", invite.getString("email")).put("role", invite.optString("role", "member"));
                call("POST", "/api/v1/invitations", body, this::reload);
            } catch (Exception error) {
                showError(error.getMessage());
            }
        }));
        actions.addView(action("Annuler", () -> call("DELETE", "/api/v1/invitations/" + invite.optString("id"), null, this::reload)));
        row.addView(actions);
        return row;
    }

    private void chooseRole(JSONObject member) {
        int current = roleIndex(member.optString("role"));
        int[] picked = {current};
        new AlertDialog.Builder(activity)
            .setTitle("Rôle de " + member.optString("name"))
            .setSingleChoiceItems(ROLE_LABELS, current, (dialog, which) -> picked[0] = which)
            .setPositiveButton("Enregistrer", (dialog, which) -> {
                if (picked[0] == current) return;
                try {
                    call("PATCH", "/api/v1/members/" + member.getString("id"), new JSONObject().put("role", ROLE_CODES[picked[0]]), this::reload);
                } catch (Exception error) {
                    showError(error.getMessage());
                }
            })
            .setNegativeButton("Annuler", null)
            .show();
    }

    private void confirmRemoval(JSONObject member, JSONArray members) {
        new AlertDialog.Builder(activity)
            .setTitle("Retirer " + member.optString("name"))
            .setMessage("Cette personne n’aura plus accès à cet espace. Son compte reste le sien.")
            .setPositiveButton("Retirer", (dialog, which) -> {
                try {
                    call("PATCH", "/api/v1/members/" + member.getString("id"), new JSONObject().put("active", false), this::reload, error -> {
                        if (error.getMessage() != null && error.getMessage().contains("reprendre")) askTransfer(member, members);
                        else showError(error.getMessage());
                    });
                } catch (Exception error) {
                    showError(error.getMessage());
                }
            })
            .setNegativeButton("Annuler", null)
            .show();
    }

    private void askTransfer(JSONObject member, JSONArray members) {
        try {
            JSONArray others = new JSONArray();
            for (int i = 0; i < members.length(); i++) {
                JSONObject candidate = members.getJSONObject(i);
                if (candidate.optBoolean("active") && !candidate.getString("id").equals(member.getString("id"))) others.put(candidate);
            }
            if (others.length() == 0) {
                showError("Choisissez un membre actif pour reprendre les fiches et relances.");
                return;
            }
            String[] names = new String[others.length()];
            for (int i = 0; i < others.length(); i++) names[i] = others.getJSONObject(i).optString("name");
            int[] picked = {0};
            new AlertDialog.Builder(activity)
                .setTitle("Réattribuer les fiches")
                .setSingleChoiceItems(names, 0, (dialog, which) -> picked[0] = which)
                .setPositiveButton("Retirer et réattribuer", (dialog, which) -> {
                    try {
                        JSONObject body = new JSONObject().put("active", false).put("transfer_to", others.getJSONObject(picked[0]).getString("id"));
                        call("PATCH", "/api/v1/members/" + member.getString("id"), body, this::reload);
                    } catch (Exception error) {
                        showError(error.getMessage());
                    }
                })
                .setNegativeButton("Annuler", null)
                .show();
        } catch (Exception error) {
            showError(error.getMessage());
        }
    }

    private LinearLayout privacyCard() {
        LinearLayout card = section("Confidentialité", "Le traitement des cartes de visite est décrit dans la politique de confidentialité.");
        card.addView(ui.secondary("Politique de confidentialité", () -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(api.base.replaceAll("/+$", "") + "/privacy")));
            } catch (Exception error) {
                showError("La politique de confidentialité est publiée sur ciblix.com/privacy.");
            }
        }));
        return card;
    }

    private LinearLayout section(String title, String detail) {
        LinearLayout card = ui.surfaceCard();
        ui.margin(card, 12, 0);
        card.addView(ui.label(title, 18, UiKit.PETROLEUM, true));
        TextView help = ui.subtitle(detail);
        help.setPadding(0, ui.dp(4), 0, ui.dp(8));
        card.addView(help);
        return card;
    }

    private TextView heading(String value) {
        TextView title = ui.label(value, 15, UiKit.PETROLEUM, true);
        title.setPadding(0, ui.dp(16), 0, ui.dp(4));
        return title;
    }

    private android.widget.Button action(String label, Runnable task) {
        android.widget.Button button = ui.ghost(label, task);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1);
        button.setLayoutParams(params);
        return button;
    }

    private void reload() { load(content); }

    private void call(String method, String path, JSONObject body, Runnable done) {
        call(method, path, body, done, error -> showError(error.getMessage()));
    }

    private void call(String method, String path, JSONObject body, Runnable done, java.util.function.Consumer<Exception> failed) {
        if (working) return;
        working = true;
        showError("");
        int seen = generation.getAsInt();
        worker.execute(() -> {
            Exception failure = null;
            try { api.request(method, path, body); }
            catch (Exception error) { failure = error; }
            Exception problem = failure;
            activity.runOnUiThread(() -> {
                working = false;
                if (activity.isDestroyed() || seen != generation.getAsInt()) return;
                if (problem == null) done.run();
                else if (unauthorized(problem)) signedOut.run();
                else failed.accept(problem);
            });
        });
    }

    private void showError(String message) {
        if (banner == null) return;
        boolean empty = message == null || message.isBlank();
        banner.setText(empty ? "" : message);
        banner.setTextColor(empty ? UiKit.MUTED : UiKit.DANGER);
        banner.setVisibility(empty ? View.GONE : View.VISIBLE);
    }

    private boolean current() {
        return !activity.isDestroyed() && stamp == generation.getAsInt();
    }

    private static boolean unauthorized(Exception error) {
        return error instanceof ApiClient.Failure && ((ApiClient.Failure) error).status == 401;
    }

    private static String roleLabel(String role) {
        return switch (role) {
            case "admin" -> "Administrateur";
            case "reader" -> "Lecture seule";
            default -> "Commercial";
        };
    }

    private static int roleIndex(String role) {
        for (int i = 0; i < ROLE_CODES.length; i++) if (ROLE_CODES[i].equals(role)) return i;
        return 0;
    }

    private static boolean expired(String value) {
        if (value == null || value.isBlank()) return false;
        try { return OffsetDateTime.parse(value).isBefore(OffsetDateTime.now()); }
        catch (Exception ignored) { return false; }
    }
}
