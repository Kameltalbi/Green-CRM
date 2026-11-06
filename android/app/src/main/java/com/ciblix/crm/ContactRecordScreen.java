package com.ciblix.crm;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;

/** Fiche contact plein écran. Les rubriques restent en mémoire quand on change de sélecteur. */
final class ContactRecordScreen {
    interface Listener {
        boolean alive();
        boolean canWrite();
        String memberName(String userId);
        void onCompany(String companyId);
        void onPlanFollowup(String contactId);
        void onEditFollowup(JSONObject followup);
        void onPane(int pane);
        void onSessionExpired();
        void onStatus(String message, int color);
    }

    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm", Locale.FRENCH);
    private static final ZoneId TUNIS = ZoneId.of("Africa/Tunis");
    private static final String[] STATUS_VALUES = {"", "à organiser", "en cours", "en attente", "gagné", "perdu", "inactif"};
    private static final String[] STATUS_LABELS = {"Non renseigné", "À organiser", "En cours", "En attente", "Gagné", "Perdu", "Inactif"};
    private static final int PAGE = 20;

    private final Activity activity;
    private final UiKit ui;
    private final ApiClient api;
    private final ExecutorService worker;
    private final Listener listener;
    private final String contactId;
    private final boolean preview;
    private final List<String> paneLabels = new ArrayList<>(List.of("Informations", "E-mails", "Activités", "Relances"));

    private LinearLayout content;
    private LinearLayout actions;
    private Spinner rubric;
    private TextView avatarView;
    private TextView nameView;
    private TextView jobView;
    private TextView companyView;
    private TextView badgeView;
    private ImageButton editButton;
    private ArrayAdapter<String> rubricAdapter;
    private boolean suppressRubric;
    private boolean editing;
    private boolean composingNote;
    private int pane;
    private String openMessageId;
    private JSONObject openMessage;
    private String messageError;

    private JSONObject record = new JSONObject();
    private String companyId = "";
    private String companyName = "";
    private String companyAddress = "";
    private String companyWebsite = "";
    private String ownerName = "";
    private final List<String> addresses = new ArrayList<>();

    private JSONArray emails;
    private int emailsTotal = -1;
    private String emailsError;
    private JSONArray notes;
    private int notesTotal = -1;
    private String notesError;
    private JSONArray activities;
    private int activitiesTotal = -1;
    private String activitiesError;
    private JSONArray followups;
    private int followupsTotal = -1;
    private String followupsError;
    private boolean loadingExtras;

    private final List<String> companyIds = new ArrayList<>();
    private final List<String> companyNames = new ArrayList<>();
    private String companiesError = "";

    ContactRecordScreen(Activity activity, UiKit ui, ApiClient api, ExecutorService worker, Listener listener, String contactId, JSONObject seed, int pane, boolean preview) {
        this.activity = activity;
        this.ui = ui;
        this.api = api;
        this.worker = worker;
        this.listener = listener;
        this.contactId = contactId;
        this.preview = preview;
        this.pane = Math.max(0, Math.min(3, pane));
        if (seed != null) record = seed;
        companyId = text(record, "company_id");
        companyName = text(record, "company_name");
        ownerName = text(record, "owner_name");
    }

    void attach(LinearLayout chrome, LinearLayout content) {
        this.content = content;
        chrome.addView(header());
        actions = actionRow();
        chrome.addView(actions);
        chrome.addView(rubric());
        if (preview) showPreview();
        else {
            paintHeader();
            showPane();
            load();
        }
    }

    boolean handleBack() {
        if (!listener.alive()) return false;
        if (editing) {
            editing = false;
            rubric.setVisibility(View.VISIBLE);
            refreshActions();
            showPane();
            return true;
        }
        if (openMessageId != null) {
            openMessageId = null;
            openMessage = null;
            messageError = null;
            showPane();
            return true;
        }
        return false;
    }

    private LinearLayout header() {
        LinearLayout row = ui.row();
        row.setPadding(0, ui.dp(8), 0, ui.dp(4));
        avatarView = ui.label(initials(text(record, "name")), 16, UiKit.PETROLEUM, true);
        avatarView.setGravity(Gravity.CENTER);
        avatarView.setBackground(ui.round(UiKit.SAGE_WASH, 99));
        LinearLayout.LayoutParams avatarLp = new LinearLayout.LayoutParams(ui.dp(48), ui.dp(48));
        avatarLp.rightMargin = ui.dp(12);
        avatarView.setLayoutParams(avatarLp);
        row.addView(avatarView);

        LinearLayout identity = ui.column();
        identity.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        nameView = ui.label(text(record, "name").isEmpty() ? "Contact" : text(record, "name"), 22, UiKit.PETROLEUM, true);
        nameView.setLetterSpacing(-0.02f);
        identity.addView(nameView);
        jobView = ui.label("", 14, UiKit.MUTED, false);
        identity.addView(jobView);
        companyView = ui.label("", 15, UiKit.SAGE, true);
        companyView.setOnClickListener(v -> {
            if (!companyId.isEmpty()) listener.onCompany(companyId);
        });
        identity.addView(companyView);
        row.addView(identity);

        LinearLayout side = ui.column();
        side.setGravity(Gravity.END);
        badgeView = ui.label("", 12, UiKit.SAGE, true);
        badgeView.setBackground(ui.round(UiKit.SAGE_WASH, 99));
        badgeView.setPadding(ui.dp(10), ui.dp(4), ui.dp(10), ui.dp(4));
        side.addView(badgeView);
        editButton = new ImageButton(activity);
        editButton.setImageResource(R.drawable.ic_edit);
        editButton.setColorFilter(UiKit.PETROLEUM);
        editButton.setBackground(ui.round(UiKit.FIELD, 12));
        editButton.setContentDescription("Modifier");
        editButton.setPadding(ui.dp(8), ui.dp(8), ui.dp(8), ui.dp(8));
        LinearLayout.LayoutParams editLp = new LinearLayout.LayoutParams(ui.dp(40), ui.dp(40));
        editLp.topMargin = ui.dp(8);
        editButton.setLayoutParams(editLp);
        editButton.setOnClickListener(v -> startEdit());
        side.addView(editButton);
        row.addView(side);
        return row;
    }

    private LinearLayout actionRow() {
        LinearLayout row = ui.row();
        row.setPadding(0, ui.dp(4), 0, ui.dp(8));
        return row;
    }

    private Spinner rubric() {
        rubric = new Spinner(activity);
        rubric.setBackground(ui.round(UiKit.FIELD, 12));
        rubric.setPadding(ui.dp(12), ui.dp(4), ui.dp(12), ui.dp(4));
        rubric.setMinimumHeight(ui.dp(48));
        rubric.setContentDescription("Rubrique de la fiche");
        rubricAdapter = new ArrayAdapter<>(activity, android.R.layout.simple_spinner_item, paneLabels) {
            @Override public View getView(int position, View convertView, ViewGroup parent) {
                TextView label = (TextView) super.getView(position, convertView, parent);
                label.setTextColor(UiKit.PETROLEUM);
                label.setTextSize(16);
                return label;
            }
            @Override public View getDropDownView(int position, View convertView, ViewGroup parent) {
                TextView label = (TextView) super.getDropDownView(position, convertView, parent);
                label.setTextColor(UiKit.PETROLEUM);
                label.setTextSize(16);
                label.setPadding(ui.dp(16), ui.dp(12), ui.dp(16), ui.dp(12));
                return label;
            }
        };
        rubricAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        rubric.setAdapter(rubricAdapter);
        rubric.setSelection(pane);
        rubric.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            private boolean first = true;
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                if (suppressRubric || first) { first = false; return; }
                if (position == pane && openMessageId == null && !editing) return;
                editing = false;
                composingNote = false;
                openMessageId = null;
                openMessage = null;
                messageError = null;
                pane = position;
                listener.onPane(pane);
                rubric.setVisibility(View.VISIBLE);
                refreshActions();
                showPane();
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) {}
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = ui.dp(8);
        rubric.setLayoutParams(lp);
        return rubric;
    }

    private void paintHeader() {
        String name = text(record, "name");
        avatarView.setText(initials(name));
        nameView.setText(name.isEmpty() ? "Contact" : name);
        String job = text(record, "job_title");
        jobView.setText(job);
        jobView.setVisibility(job.isEmpty() ? View.GONE : View.VISIBLE);
        companyView.setText(companyName);
        companyView.setVisibility(companyName.isEmpty() ? View.GONE : View.VISIBLE);
        String status = statusLabel(text(record, "status"));
        badgeView.setText(status);
        badgeView.setVisibility(status.isEmpty() ? View.GONE : View.VISIBLE);
        editButton.setVisibility(listener.canWrite() && !editing ? View.VISIBLE : View.GONE);
        refreshActions();
    }

    private void refreshActions() {
        actions.removeAllViews();
        if (editing) {
            actions.setVisibility(View.GONE);
            return;
        }
        String phone = firstFilled(text(record, "phone"), text(record, "phone_work"));
        String mail = addresses.isEmpty() ? "" : addresses.get(0);
        String whatsapp = text(record, "whatsapp");
        if (!phone.isEmpty()) actions.addView(action("Appeler", () -> dial(phone)));
        if (!mail.isEmpty()) actions.addView(action("E-mail", () -> mailTo(mail)));
        if (!whatsapp.isEmpty()) actions.addView(action("WhatsApp", () -> whatsApp(whatsapp)));
        actions.setVisibility(actions.getChildCount() == 0 ? View.GONE : View.VISIBLE);
    }

    private TextView action(String label, Runnable run) {
        TextView view = ui.label(label, 15, UiKit.SAGE, true);
        view.setGravity(Gravity.CENTER);
        view.setPadding(ui.dp(8), ui.dp(10), ui.dp(8), ui.dp(10));
        view.setOnClickListener(v -> run.run());
        view.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        view.setContentDescription(label);
        return view;
    }

    private void showPane() {
        if (content == null || !listener.alive()) return;
        content.removeAllViews();
        if (editing) {
            paintEditor();
            return;
        }
        if (openMessageId != null && pane == 1) {
            paintMessage();
            return;
        }
        switch (pane) {
            case 1 -> paintEmails();
            case 2 -> paintActivities();
            case 3 -> paintFollowups();
            default -> paintInfo();
        }
    }

    private void paintInfo() {
        if (record.length() == 0 && loadingExtras) {
            content.addView(ui.subtitle("Chargement…"));
            return;
        }
        LinearLayout coordinates = section("Coordonnées");
        linkRow(coordinates, "Téléphone mobile", text(record, "phone"), () -> dial(text(record, "phone")));
        linkRow(coordinates, "Téléphone professionnel", text(record, "phone_work"), () -> dial(text(record, "phone_work")));
        for (String address : addresses) linkRow(coordinates, "Adresse e-mail", address, () -> mailTo(address));
        if (!text(record, "whatsapp").isEmpty()) linkRow(coordinates, "WhatsApp", text(record, "whatsapp"), () -> whatsApp(text(record, "whatsapp")));
        valueRow(coordinates, "Adresse professionnelle", companyAddress);
        if (!companyWebsite.isEmpty()) linkRow(coordinates, "Site web", companyWebsite, () -> openWeb(companyWebsite));
        addSection(coordinates);

        LinearLayout work = section("Informations professionnelles");
        valueRow(work, "Entreprise associée", companyName);
        valueRow(work, "Poste ou fonction", text(record, "job_title"));
        valueRow(work, "Service ou département", text(record, "department"));
        valueRow(work, "Statut commercial", statusLabel(text(record, "status")));
        valueRow(work, "Source du contact", text(record, "source"));
        valueRow(work, "Responsable commercial", ownerName);
        addSection(work);

        LinearLayout extra = section("Informations complémentaires");
        if (notes != null) {
            for (int i = 0; i < notes.length(); i++) {
                JSONObject note = notes.optJSONObject(i);
                if (note == null) continue;
                valueRow(extra, "Note", text(note, "body"));
            }
        }
        valueRow(extra, "Date de création", when(text(record, "created_at")));
        valueRow(extra, "Dernière modification", when(text(record, "updated_at")));
        addSection(extra);
        if (content.getChildCount() == 0) content.addView(ui.subtitle("Aucune information enregistrée."));
    }

    private void paintEmails() {
        TextView refresh = ui.label("Actualiser", 14, UiKit.SAGE, true);
        refresh.setPadding(0, ui.dp(8), 0, ui.dp(8));
        refresh.setOnClickListener(v -> reloadEmails());
        content.addView(refresh);
        if (emailsError != null && emails == null) {
            content.addView(ui.subtitle(emailsError));
            content.addView(retry("Réessayer", this::reloadEmails));
            return;
        }
        if (emails == null) {
            content.addView(ui.subtitle("Chargement des e-mails…"));
            return;
        }
        if (emails.length() == 0) {
            content.addView(ui.subtitle("Aucun e-mail synchronisé pour ce contact."));
            return;
        }
        for (int i = 0; i < emails.length(); i++) {
            JSONObject message = emails.optJSONObject(i);
            if (message == null) continue;
            if (i > 0) divider();
            content.addView(emailRow(message));
        }
        if (emails.length() < emailsTotal) content.addView(retry("Afficher la suite", this::moreEmails));
    }

    private LinearLayout emailRow(JSONObject message) {
        LinearLayout row = ui.column();
        row.setPadding(0, ui.dp(10), 0, ui.dp(10));
        LinearLayout top = ui.row();
        boolean outbound = "outbound".equals(message.optString("direction"));
        TextView badge = ui.label(outbound ? "Envoyé" : "Reçu", 12, outbound ? UiKit.PETROLEUM : UiKit.SAGE, true);
        badge.setBackground(ui.round(outbound ? UiKit.MIST : UiKit.SAGE_WASH, 99));
        badge.setPadding(ui.dp(10), ui.dp(4), ui.dp(10), ui.dp(4));
        badge.setSingleLine(true);
        top.addView(badge);
        View spacer = new View(activity);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(0, 1, 1));
        top.addView(spacer);
        TextView date = ui.label(when(text(message, "internal_date")), 13, UiKit.MUTED, false);
        date.setSingleLine(true);
        top.addView(date);
        row.addView(top);
        TextView subject = ui.label(mailText(text(message, "subject").isEmpty() ? "(sans objet)" : text(message, "subject")), 16, UiKit.PETROLEUM, true);
        subject.setPadding(0, ui.dp(6), 0, 0);
        row.addView(subject);
        TextView preview = ui.label(mailText(text(message, "snippet")), 14, UiKit.MUTED, false);
        preview.setMaxLines(2);
        preview.setEllipsize(android.text.TextUtils.TruncateAt.END);
        row.addView(preview);
        String id = text(message, "id");
        row.setOnClickListener(v -> openMessage(id));
        row.setContentDescription((outbound ? "Envoyé" : "Reçu") + ", " + subject.getText());
        return row;
    }

    private void paintMessage() {
        if (messageError != null) {
            content.addView(ui.subtitle(messageError));
            content.addView(retry("Réessayer", () -> openMessage(openMessageId)));
            return;
        }
        if (openMessage == null) {
            content.addView(ui.subtitle("Chargement du message…"));
            return;
        }
        boolean outbound = "outbound".equals(openMessage.optString("direction"));
        TextView badge = ui.label(outbound ? "Envoyé" : "Reçu", 12, outbound ? UiKit.PETROLEUM : UiKit.SAGE, true);
        badge.setBackground(ui.round(outbound ? UiKit.MIST : UiKit.SAGE_WASH, 99));
        badge.setPadding(ui.dp(10), ui.dp(4), ui.dp(10), ui.dp(4));
        LinearLayout top = ui.row();
        top.setPadding(0, ui.dp(8), 0, ui.dp(8));
        top.addView(badge);
        View spacer = new View(activity);
        spacer.setLayoutParams(new LinearLayout.LayoutParams(0, 1, 1));
        top.addView(spacer);
        top.addView(ui.label(when(text(openMessage, "date")), 13, UiKit.MUTED, false));
        content.addView(top);
        TextView subject = ui.label(mailText(text(openMessage, "subject").isEmpty() ? "(sans objet)" : text(openMessage, "subject")), 20, UiKit.PETROLEUM, true);
        content.addView(subject);
        valueRow(content, "De", text(openMessage, "from"));
        valueRow(content, "À", join(openMessage.optJSONArray("to")));
        valueRow(content, "Cc", join(openMessage.optJSONArray("cc")));
        if (openMessage.optBoolean("hasAttachments")) content.addView(ui.subtitle("Contient une pièce jointe."));
        TextView body = ui.label(mailText(firstFilled(text(openMessage, "body"), text(openMessage, "snippet"))), 16, UiKit.PETROLEUM, false);
        body.setPadding(0, ui.dp(12), 0, ui.dp(12));
        content.addView(body);
    }

    private void paintActivities() {
        if (listener.canWrite()) {
            TextView add = ui.label(composingNote ? "Fermer la note" : "Ajouter une note", 14, UiKit.SAGE, true);
            add.setPadding(0, ui.dp(8), 0, ui.dp(8));
            add.setOnClickListener(v -> {
                composingNote = !composingNote;
                showPane();
            });
            content.addView(add);
            if (composingNote) content.addView(noteComposer());
        }
        if (notesError != null && notes == null) content.addView(ui.subtitle(notesError));
        if (activitiesError != null && activities == null && notes == null) {
            content.addView(ui.subtitle(activitiesError));
            content.addView(retry("Réessayer", this::reloadActivities));
            return;
        }
        if (activities == null && notes == null) {
            content.addView(ui.subtitle("Chargement des activités…"));
            return;
        }
        List<JSONObject> rows = mergedActivities();
        if (rows.isEmpty()) {
            content.addView(ui.subtitle("Aucune activité enregistrée."));
            return;
        }
        for (int i = 0; i < rows.size(); i++) {
            if (i > 0) divider();
            content.addView(activityRow(rows.get(i)));
        }
        boolean moreNotes = notes != null && notes.length() < notesTotal;
        boolean moreActivities = activities != null && activities.length() < activitiesTotal;
        if (moreNotes || moreActivities) content.addView(retry("Afficher la suite", this::moreActivities));
    }

    private LinearLayout noteComposer() {
        LinearLayout box = ui.column();
        EditText input = new EditText(activity);
        input.setMinLines(3);
        input.setHint("Note partagée");
        input.setTextSize(16);
        input.setTextColor(UiKit.PETROLEUM);
        input.setHintTextColor(UiKit.MUTED);
        input.setBackground(ui.round(UiKit.FIELD, 12));
        input.setPadding(ui.dp(14), ui.dp(12), ui.dp(14), ui.dp(12));
        box.addView(input);
        box.addView(ui.primary("Enregistrer la note", () -> saveNote(input)));
        return box;
    }

    private LinearLayout activityRow(JSONObject item) {
        LinearLayout row = ui.column();
        row.setPadding(0, ui.dp(8), 0, ui.dp(8));
        TextView type = ui.label(text(item, "type"), 12, UiKit.SAGE, true);
        row.addView(type);
        TextView contentView = ui.label(text(item, "content"), 16, UiKit.PETROLEUM, false);
        row.addView(contentView);
        String meta = joinParts(text(item, "author"), text(item, "when"));
        if (!meta.isEmpty()) row.addView(ui.subtitle(meta));
        return row;
    }

    private void paintFollowups() {
        if (listener.canWrite()) content.addView(ui.primary("Planifier une relance", () -> listener.onPlanFollowup(contactId)));
        if (followupsError != null && followups == null) {
            content.addView(ui.subtitle(followupsError));
            content.addView(retry("Réessayer", this::reloadFollowups));
            return;
        }
        if (followups == null) {
            content.addView(ui.subtitle("Chargement des relances…"));
            return;
        }
        List<JSONObject> upcoming = new ArrayList<>();
        List<JSONObject> past = new ArrayList<>();
        for (int i = 0; i < followups.length(); i++) {
            JSONObject item = followups.optJSONObject(i);
            if (item == null) continue;
            if ("pending".equals(item.optString("status"))) upcoming.add(item);
            else past.add(item);
        }
        past.sort(Comparator.comparing((JSONObject item) -> text(item, "due_at")).reversed());
        content.addView(sectionTitle("Relances à venir"));
        if (upcoming.isEmpty()) content.addView(ui.subtitle("Aucune relance à venir."));
        for (JSONObject item : upcoming) content.addView(followupRow(item, true));
        content.addView(sectionTitle("Historique des relances"));
        if (past.isEmpty()) content.addView(ui.subtitle("Aucune relance terminée ou annulée."));
        for (JSONObject item : past) content.addView(followupRow(item, false));
        if (followups.length() < followupsTotal) content.addView(retry("Afficher la suite", this::moreFollowups));
    }

    private LinearLayout followupRow(JSONObject item, boolean pending) {
        LinearLayout row = ui.column();
        row.setPadding(0, ui.dp(10), 0, ui.dp(6));
        row.addView(ui.label(text(item, "subject"), 16, UiKit.PETROLEUM, true));
        row.addView(ui.subtitle(when(text(item, "due_at"))));
        String owner = listener.memberName(text(item, "owner_user_id"));
        if (!owner.isEmpty()) row.addView(ui.subtitle(owner));
        row.addView(ui.subtitle(followupStatus(item)));
        String reason = text(item, "cancellation_reason");
        if (!reason.isEmpty()) row.addView(ui.subtitle(reason));
        if (pending && listener.canWrite()) {
            LinearLayout commands = ui.row();
            TextView edit = ui.label("Modifier", 14, UiKit.SAGE, true);
            edit.setPadding(0, ui.dp(6), ui.dp(16), ui.dp(6));
            edit.setOnClickListener(v -> listener.onEditFollowup(item));
            TextView done = ui.label("Terminer", 14, UiKit.SAGE, true);
            done.setPadding(0, ui.dp(6), ui.dp(8), ui.dp(6));
            done.setOnClickListener(v -> completeFollowup(item));
            commands.addView(edit);
            commands.addView(done);
            row.addView(commands);
        }
        return row;
    }

    private void paintEditor() {
        rubric.setVisibility(View.GONE);
        LinearLayout form = ui.column();
        EditText name = ui.field(form, "Nom et prénom", text(record, "name"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_WORDS);
        EditText job = ui.field(form, "Fonction", text(record, "job_title"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        EditText department = ui.field(form, "Service", text(record, "department"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        EditText phone = ui.field(form, "Téléphone mobile", text(record, "phone"), InputType.TYPE_CLASS_PHONE);
        EditText phoneWork = ui.field(form, "Téléphone professionnel", text(record, "phone_work"), InputType.TYPE_CLASS_PHONE);
        EditText whatsapp = ui.field(form, "WhatsApp", text(record, "whatsapp"), InputType.TYPE_CLASS_PHONE);
        EditText source = ui.field(form, "Source", text(record, "source"), InputType.TYPE_CLASS_TEXT);
        EditText mails = ui.field(form, "Adresses e-mail", String.join("\n", addresses), InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        mails.setSingleLine(false);
        mails.setMinLines(2);
        form.addView(ui.label("Statut commercial", 13, UiKit.MUTED, false));
        Spinner status = new Spinner(activity);
        status.setAdapter(new ArrayAdapter<>(activity, android.R.layout.simple_spinner_dropdown_item, STATUS_LABELS));
        status.setSelection(statusIndex(text(record, "status")));
        form.addView(status);
        form.addView(ui.label("Entreprise existante", 13, UiKit.MUTED, false));
        Spinner company = new Spinner(activity);
        company.setAdapter(new ArrayAdapter<>(activity, android.R.layout.simple_spinner_dropdown_item, companyNames));
        int companyIndex = companyIds.indexOf(companyId);
        if (companyIndex >= 0) company.setSelection(companyIndex);
        form.addView(company);
        if (!companiesError.isEmpty()) form.addView(ui.subtitle(companiesError));
        TextView error = ui.subtitle("");
        error.setTextColor(UiKit.DANGER);
        form.addView(error);
        form.addView(ui.primary("Enregistrer", () -> saveContact(name, job, department, phone, phoneWork, whatsapp, source, mails, status, company, error)));
        content.addView(form);
    }

    private void showPreview() {
        try {
            record = new JSONObject().put("name", "Maha Ben Gaied").put("job_title", "Qualité").put("status", "en cours").put("phone", "55000001").put("phone_work", "71000001").put("department", "Qualité").put("source", "Session Juill 2026").put("created_at", "2026-11-06T18:10:00Z").put("updated_at", "2026-11-06T19:10:00Z");
            companyName = "Groupe Kilani KGS";
            companyId = "preview-company";
            companyAddress = "Tunis";
            ownerName = "Kamel Talbi";
            addresses.clear();
            addresses.add("bengaied.maha@kilanigroupe.com");
            emails = new JSONArray().put(new JSONObject().put("id", "m1").put("direction", "outbound").put("subject", "DecarboTech et CarboScan").put("snippet", "Bonjour Maha, suite à notre discussion.").put("internal_date", "2026-10-19T07:51:00Z").put("from_email", "kameltalbi.tn@gmail.com"));
            emailsTotal = 1;
            notes = new JSONArray().put(new JSONObject().put("body", "Échange prévu après le salon.").put("created_at", "2026-11-06T18:10:00Z").put("author_user_id", ""));
            notesTotal = 1;
            activities = new JSONArray().put(new JSONObject().put("action", "created").put("summary", "Création : Maha Ben Gaied").put("created_at", "2026-11-06T18:10:00Z").put("actor_name", "Kamel Talbi"));
            activitiesTotal = 1;
            followups = new JSONArray().put(new JSONObject().put("id", "f1").put("subject", "Relancer après le salon").put("status", "pending").put("due_at", "2026-11-20T09:00:00+01:00").put("owner_user_id", ""));
            followupsTotal = 1;
            companyIds.clear();
            companyIds.add("");
            companyIds.add("preview-company");
            companyNames.clear();
            companyNames.add("Sans entreprise");
            companyNames.add("Groupe Kilani KGS");
        } catch (Exception ignored) {}
        paintHeader();
        showPane();
    }

    private void load() {
        loadingExtras = true;
        showPane();
        worker.execute(() -> {
            JSONObject nextRecord = null;
            String failure = null;
            try { nextRecord = api.request("GET", "/api/v1/contacts/" + contactId, null); }
            catch (Exception error) {
                if (unauthorized(error)) return;
                failure = messageOf(error);
            }
            JSONObject listed = null;
            if (nextRecord != null) {
                try { listed = api.request("GET", "/api/v1/contacts?contact_id=" + contactId + "&archived=true&limit=1", null); }
                catch (Exception error) { if (unauthorized(error)) return; }
            }
            JSONObject finalRecord = nextRecord;
            JSONObject finalListed = listed;
            String finalFailure = failure;
            activity.runOnUiThread(() -> {
                if (!listener.alive()) return;
                loadingExtras = false;
                if (finalRecord == null) {
                    content.removeAllViews();
                    content.addView(ui.subtitle(finalFailure == null ? "Fiche introuvable." : finalFailure));
                    content.addView(retry("Réessayer", this::load));
                    return;
                }
                record = finalRecord;
                applyListed(finalListed);
                paintHeader();
                showPane();
            });
            if (nextRecord == null) return;
            loadEmails(false);
            loadNotes(false);
            loadActivities(false);
            loadFollowups(false);
        });
    }

    private void applyListed(JSONObject listed) {
        addresses.clear();
        if (listed == null) return;
        JSONArray items = listed.optJSONArray("items");
        if (items != null && items.length() > 0) {
            JSONObject row = items.optJSONObject(0);
            if (row != null) {
                if (!text(row, "company_name").isEmpty()) companyName = text(row, "company_name");
                if (!text(row, "owner_name").isEmpty()) ownerName = text(row, "owner_name");
                if (!text(row, "company_id").isEmpty()) companyId = text(row, "company_id");
            }
        }
        JSONObject related = listed.optJSONObject("related");
        if (related == null) return;
        JSONArray mails = related.optJSONArray("contact_emails");
        if (mails != null) {
            for (int i = 0; i < mails.length(); i++) {
                JSONObject mail = mails.optJSONObject(i);
                if (mail != null && contactId.equals(text(mail, "contact_id")) && !text(mail, "email").isEmpty()) addresses.add(text(mail, "email"));
            }
        }
        JSONArray companies = related.optJSONArray("companies");
        if (companies != null) {
            for (int i = 0; i < companies.length(); i++) {
                JSONObject company = companies.optJSONObject(i);
                if (company != null && companyId.equals(text(company, "id"))) {
                    companyName = firstFilled(text(company, "name"), companyName);
                    companyAddress = joinParts(text(company, "address"), text(company, "city"), text(company, "country"));
                    companyWebsite = text(company, "website");
                }
            }
        }
    }

    private void loadEmails(boolean append) {
        int offset = append && emails != null ? emails.length() : 0;
        worker.execute(() -> {
            try {
                JSONObject data = api.request("GET", "/api/v1/contacts/" + contactId + "/emails?limit=" + PAGE + "&offset=" + offset, null);
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    emailsError = null;
                    emailsTotal = data.optInt("total", 0);
                    JSONArray page = data.optJSONArray("items");
                    if (!append || emails == null) emails = new JSONArray();
                    if (page != null) for (int i = 0; i < page.length(); i++) emails.put(page.opt(i));
                    setEmailCount();
                    if (pane == 1 && openMessageId == null && !editing) showPane();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    if (!append) emails = null;
                    emailsError = messageOf(error);
                    if (pane == 1 && !editing) showPane();
                });
            }
        });
    }

    private void loadNotes(boolean append) {
        int offset = append && notes != null ? notes.length() : 0;
        worker.execute(() -> {
            try {
                JSONObject data = api.request("GET", "/api/v1/notes?contact_id=" + contactId + "&limit=" + PAGE + "&offset=" + offset, null);
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    notesError = null;
                    notesTotal = data.optInt("total", 0);
                    JSONArray page = data.optJSONArray("items");
                    if (!append || notes == null) notes = new JSONArray();
                    if (page != null) for (int i = 0; i < page.length(); i++) notes.put(page.opt(i));
                    if ((pane == 0 || pane == 2) && !editing && openMessageId == null) showPane();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    if (!append) notes = null;
                    notesError = messageOf(error);
                    if (pane == 2 && !editing) showPane();
                });
            }
        });
    }

    private void loadActivities(boolean append) {
        int offset = append && activities != null ? activities.length() : 0;
        worker.execute(() -> {
            try {
                JSONObject data = api.request("GET", "/api/v1/contacts/" + contactId + "/history?limit=" + PAGE + "&offset=" + offset, null);
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    activitiesError = null;
                    activitiesTotal = data.optInt("total", 0);
                    JSONArray page = data.optJSONArray("items");
                    if (!append || activities == null) activities = new JSONArray();
                    if (page != null) for (int i = 0; i < page.length(); i++) activities.put(page.opt(i));
                    if (pane == 2 && !editing) showPane();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    if (!append) activities = null;
                    activitiesError = messageOf(error);
                    if (pane == 2 && !editing) showPane();
                });
            }
        });
    }

    private void loadFollowups(boolean append) {
        int offset = append && followups != null ? followups.length() : 0;
        worker.execute(() -> {
            try {
                JSONObject data = api.request("GET", "/api/v1/followups?contact_id=" + contactId + "&limit=" + PAGE + "&offset=" + offset, null);
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    followupsError = null;
                    followupsTotal = data.optInt("total", 0);
                    JSONArray page = data.optJSONArray("items");
                    if (!append || followups == null) followups = new JSONArray();
                    if (page != null) for (int i = 0; i < page.length(); i++) followups.put(page.opt(i));
                    if (pane == 3 && !editing) showPane();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    if (!append) followups = null;
                    followupsError = messageOf(error);
                    if (pane == 3 && !editing) showPane();
                });
            }
        });
    }

    private void reloadEmails() { emails = null; emailsError = null; showPane(); loadEmails(false); }
    private void moreEmails() { loadEmails(true); }
    private void reloadActivities() { activities = null; notes = null; activitiesError = null; notesError = null; showPane(); loadActivities(false); loadNotes(false); }
    private void moreActivities() { if (notes != null && notes.length() < notesTotal) loadNotes(true); if (activities != null && activities.length() < activitiesTotal) loadActivities(true); }
    private void reloadFollowups() { followups = null; followupsError = null; showPane(); loadFollowups(false); }
    private void moreFollowups() { loadFollowups(true); }

    private void openMessage(String id) {
        if (id == null || id.isEmpty() || preview) {
            openMessageId = id;
            openMessage = preview && emails != null && emails.length() > 0 ? emails.optJSONObject(0) : null;
            if (openMessage != null) {
                try {
                    openMessage = new JSONObject(openMessage.toString()).put("from", text(openMessage, "from_email")).put("date", text(openMessage, "internal_date")).put("to", new JSONArray().put("bengaied.maha@kilanigroupe.com")).put("body", text(openMessage, "snippet"));
                } catch (Exception ignored) {}
            }
            showPane();
            return;
        }
        openMessageId = id;
        openMessage = null;
        messageError = null;
        showPane();
        worker.execute(() -> {
            try {
                JSONObject detail = api.request("GET", "/api/v1/gmail/synced/" + id, null);
                activity.runOnUiThread(() -> {
                    if (!listener.alive() || !id.equals(openMessageId)) return;
                    openMessage = detail;
                    showPane();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> {
                    if (!listener.alive() || !id.equals(openMessageId)) return;
                    messageError = messageOf(error);
                    showPane();
                });
            }
        });
    }

    private void saveNote(EditText input) {
        String body = input.getText().toString().trim();
        if (body.isEmpty()) { input.setError("Saisissez une note."); return; }
        if (preview) return;
        input.setEnabled(false);
        worker.execute(() -> {
            try {
                api.request("POST", "/api/v1/notes", new JSONObject().put("body", body).put("contact_id", contactId));
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    composingNote = false;
                    listener.onStatus("Note enregistrée.", UiKit.SAGE);
                    reloadActivities();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    input.setEnabled(true);
                    listener.onStatus(messageOf(error), UiKit.DANGER);
                });
            }
        });
    }

    private void completeFollowup(JSONObject item) {
        if (preview) return;
        worker.execute(() -> {
            try {
                api.request("PATCH", "/api/v1/followups/" + text(item, "id"), new JSONObject().put("status", "completed"));
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    listener.onStatus("Relance terminée.", UiKit.SAGE);
                    reloadFollowups();
                });
            } catch (Exception error) {
                if (unauthorized(error)) return;
                activity.runOnUiThread(() -> { if (listener.alive()) listener.onStatus(messageOf(error), UiKit.DANGER); });
            }
        });
    }

    private void startEdit() {
        if (!listener.canWrite() || editing) return;
        editing = true;
        openMessageId = null;
        editButton.setVisibility(View.GONE);
        refreshActions();
        content.removeAllViews();
        content.addView(ui.subtitle("Chargement du formulaire…"));
        if (preview) {
            companyIds.clear();
            companyIds.add("");
            companyIds.add(companyId.isEmpty() ? "preview-company" : companyId);
            companyNames.clear();
            companyNames.add("Sans entreprise");
            companyNames.add(companyName.isEmpty() ? "Entreprise" : companyName);
            showPane();
            return;
        }
        worker.execute(() -> {
            String failure = "";
            List<String> ids = new ArrayList<>();
            List<String> names = new ArrayList<>();
            ids.add("");
            names.add("Sans entreprise");
            try {
                JSONObject data = api.request("GET", "/api/v1/companies?limit=200", null);
                JSONArray items = data.optJSONArray("items");
                if (items != null) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject company = items.optJSONObject(i);
                        if (company == null || text(company, "id").isEmpty()) continue;
                        ids.add(text(company, "id"));
                        names.add(text(company, "name"));
                    }
                }
            } catch (Exception error) {
                if (unauthorized(error)) return;
                failure = "Liste des entreprises indisponible.";
            }
            if (!companyId.isEmpty() && !ids.contains(companyId)) {
                ids.add(companyId);
                names.add(companyName.isEmpty() ? "Entreprise actuelle" : companyName);
            }
            String finalFailure = failure;
            activity.runOnUiThread(() -> {
                if (!listener.alive() || !editing) return;
                companyIds.clear();
                companyIds.addAll(ids);
                companyNames.clear();
                companyNames.addAll(names);
                companiesError = finalFailure;
                showPane();
            });
        });
    }

    private void saveContact(EditText name, EditText job, EditText department, EditText phone, EditText phoneWork, EditText whatsapp, EditText source, EditText mails, Spinner status, Spinner company, TextView error) {
        String contactName = name.getText().toString().trim();
        if (contactName.isEmpty()) { name.setError("Indiquez le nom."); return; }
        if (preview) { editing = false; rubric.setVisibility(View.VISIBLE); paintHeader(); showPane(); return; }
        error.setText("");
        int companyPosition = company.getSelectedItemPosition();
        String selectedCompany = companyPosition >= 0 && companyPosition < companyIds.size() ? companyIds.get(companyPosition) : "";
        String selectedCompanyName = companyPosition >= 0 && companyPosition < companyNames.size() ? companyNames.get(companyPosition) : "";
        String statusValue = STATUS_VALUES[Math.max(0, Math.min(STATUS_VALUES.length - 1, status.getSelectedItemPosition()))];
        List<String> nextAddresses = new ArrayList<>();
        for (String part : mails.getText().toString().split("[\\n;,]+")) {
            String value = part.trim();
            if (!value.isEmpty() && !nextAddresses.contains(value)) nextAddresses.add(value);
        }
        worker.execute(() -> {
            try {
                JSONObject found = api.request("GET", "/api/v1/contacts?limit=20&q=" + URLEncoder.encode(contactName, "UTF-8"), null);
                JSONArray items = found.optJSONArray("items");
                if (items != null) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject other = items.optJSONObject(i);
                        if (other == null || contactId.equals(text(other, "id"))) continue;
                        if (contactName.equalsIgnoreCase(text(other, "name").trim())) {
                            activity.runOnUiThread(() -> { if (listener.alive()) error.setText("Un contact porte déjà ce nom."); });
                            return;
                        }
                    }
                }
                JSONArray mailArray = new JSONArray();
                for (String address : nextAddresses) mailArray.put(address);
                JSONObject body = new JSONObject()
                    .put("name", contactName)
                    .put("job_title", job.getText().toString().trim())
                    .put("department", department.getText().toString().trim())
                    .put("phone", phone.getText().toString().trim())
                    .put("phone_work", phoneWork.getText().toString().trim())
                    .put("whatsapp", whatsapp.getText().toString().trim())
                    .put("source", source.getText().toString().trim())
                    .put("status", statusValue)
                    .put("company_id", selectedCompany.isEmpty() ? JSONObject.NULL : selectedCompany)
                    .put("emails", mailArray);
                JSONObject saved = api.request("PATCH", "/api/v1/contacts/" + contactId, body);
                activity.runOnUiThread(() -> {
                    if (!listener.alive()) return;
                    record = saved;
                    companyId = selectedCompany;
                    companyName = selectedCompany.isEmpty() ? "" : selectedCompanyName;
                    if (selectedCompany.isEmpty()) { companyAddress = ""; companyWebsite = ""; }
                    addresses.clear();
                    addresses.addAll(nextAddresses);
                    editing = false;
                    rubric.setVisibility(View.VISIBLE);
                    paintHeader();
                    showPane();
                    listener.onStatus("Contact enregistré.", UiKit.SAGE);
                    load();
                });
            } catch (Exception exception) {
                if (unauthorized(exception)) return;
                activity.runOnUiThread(() -> { if (listener.alive()) error.setText(messageOf(exception)); });
            }
        });
    }

    private List<JSONObject> mergedActivities() {
        List<JSONObject> rows = new ArrayList<>();
        try {
            if (notes != null) {
                for (int i = 0; i < notes.length(); i++) {
                    JSONObject note = notes.optJSONObject(i);
                    if (note == null || text(note, "body").isEmpty()) continue;
                    rows.add(new JSONObject()
                        .put("sort", text(note, "created_at"))
                        .put("type", "Note")
                        .put("content", text(note, "body"))
                        .put("author", listener.memberName(text(note, "author_user_id")))
                        .put("when", when(text(note, "created_at"))));
                }
            }
            if (activities != null) {
                for (int i = 0; i < activities.length(); i++) {
                    JSONObject activity = activities.optJSONObject(i);
                    if (activity == null) continue;
                    if ("Note partagée ajoutée".equals(activity.optString("summary")) && notes != null) continue;
                    rows.add(new JSONObject()
                        .put("sort", text(activity, "created_at"))
                        .put("type", activityType(text(activity, "action")))
                        .put("content", text(activity, "summary"))
                        .put("author", text(activity, "actor_name"))
                        .put("when", when(text(activity, "created_at"))));
                }
            }
        } catch (Exception ignored) {}
        rows.sort(Comparator.comparing((JSONObject row) -> text(row, "sort")).reversed());
        return rows;
    }

    private void setEmailCount() {
        String label = emailsTotal < 0 ? "E-mails" : "E-mails (" + emailsTotal + ")";
        if (label.equals(paneLabels.get(1))) return;
        paneLabels.set(1, label);
        suppressRubric = true;
        rubricAdapter.notifyDataSetChanged();
        rubric.post(() -> suppressRubric = false);
    }

    private LinearLayout section(String title) {
        LinearLayout box = ui.column();
        box.addView(sectionTitle(title));
        return box;
    }

    private TextView sectionTitle(String title) {
        TextView view = ui.label(title, 16, UiKit.PETROLEUM, true);
        view.setPadding(0, ui.dp(16), 0, ui.dp(6));
        return view;
    }

    private void addSection(LinearLayout box) {
        if (box.getChildCount() > 1) content.addView(box);
    }

    private void valueRow(LinearLayout parent, String label, String value) {
        if (value == null || value.trim().isEmpty()) return;
        parent.addView(ui.label(label, 13, UiKit.MUTED, false));
        TextView view = ui.label(value.trim(), 16, UiKit.PETROLEUM, false);
        view.setPadding(0, 0, 0, ui.dp(8));
        parent.addView(view);
    }

    private void linkRow(LinearLayout parent, String label, String value, Runnable action) {
        if (value == null || value.trim().isEmpty()) return;
        parent.addView(ui.label(label, 13, UiKit.MUTED, false));
        TextView view = ui.label(value.trim(), 16, UiKit.SAGE, false);
        view.setPadding(0, 0, 0, ui.dp(8));
        view.setOnClickListener(v -> action.run());
        parent.addView(view);
    }

    private TextView retry(String label, Runnable action) {
        TextView view = ui.label(label, 15, UiKit.SAGE, true);
        view.setPadding(0, ui.dp(12), 0, ui.dp(8));
        view.setOnClickListener(v -> action.run());
        return view;
    }

    private void divider() {
        View line = new View(activity);
        line.setBackgroundColor(UiKit.MIST);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, Math.max(1, ui.dp(1)));
        lp.topMargin = ui.dp(2);
        line.setLayoutParams(lp);
        content.addView(line);
    }

    private void dial(String number) { open(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))), "Aucune application d’appel."); }
    private void mailTo(String address) { open(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + address)), "Aucune application e-mail."); }
    private void whatsApp(String number) {
        String digits = number.replaceAll("\\D", "");
        open(new Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/" + digits)), "WhatsApp est indisponible.");
    }
    private void openWeb(String url) {
        String target = url.startsWith("http://") || url.startsWith("https://") ? url : "https://" + url;
        open(new Intent(Intent.ACTION_VIEW, Uri.parse(target)), "Aucun navigateur disponible.");
    }
    private void open(Intent intent, String failure) {
        try { activity.startActivity(intent); }
        catch (ActivityNotFoundException error) { listener.onStatus(failure, UiKit.DANGER); }
    }

    private boolean unauthorized(Exception error) {
        if (error instanceof ApiClient.Failure && ((ApiClient.Failure) error).status == 401) {
            activity.runOnUiThread(() -> { if (listener.alive()) listener.onSessionExpired(); });
            return true;
        }
        return false;
    }

    private static String messageOf(Exception error) {
        if (error instanceof java.io.IOException) return "Serveur inaccessible. Vérifiez la connexion, puis réessayez.";
        String message = error.getMessage();
        return message == null || message.isBlank() ? "La demande a échoué." : message;
    }

    private static String when(String iso) {
        if (iso == null || iso.isBlank()) return "";
        try { return OffsetDateTime.parse(iso).atZoneSameInstant(TUNIS).format(WHEN); }
        catch (Exception error) { return iso; }
    }

    private static String text(JSONObject object, String key) {
        if (object == null || object.isNull(key)) return "";
        return object.optString(key, "");
    }

    private static String firstFilled(String... values) {
        for (String value : values) if (value != null && !value.trim().isEmpty()) return value.trim();
        return "";
    }

    private static String joinParts(String... values) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            if (value == null || value.isBlank()) continue;
            if (builder.length() > 0) builder.append(" · ");
            builder.append(value.trim());
        }
        return builder.toString();
    }

    private static String join(JSONArray values) {
        if (values == null) return "";
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < values.length(); i++) {
            String value = values.optString(i, "").trim();
            if (value.isEmpty()) continue;
            if (builder.length() > 0) builder.append(", ");
            builder.append(value);
        }
        return builder.toString();
    }

    private static String statusLabel(String value) {
        for (int i = 0; i < STATUS_VALUES.length; i++) if (STATUS_VALUES[i].equals(value)) return i == 0 ? "" : STATUS_LABELS[i];
        return value == null ? "" : value;
    }

    private static int statusIndex(String value) {
        for (int i = 0; i < STATUS_VALUES.length; i++) if (STATUS_VALUES[i].equals(value)) return i;
        return 0;
    }

    private static String activityType(String action) {
        return switch (action) {
            case "created" -> "Création";
            case "updated" -> "Mise à jour";
            case "archived" -> "Archivage";
            case "deleted" -> "Suppression";
            case "reassigned" -> "Responsable";
            default -> "Activité";
        };
    }

    private static String followupStatus(JSONObject item) {
        return switch (item.optString("status")) {
            case "completed" -> "Terminée";
            case "cancelled" -> "Annulée";
            default -> "À faire";
        };
    }

    static String mailText(String value) {
        if (value == null || value.isEmpty()) return "";
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            if (value.charAt(i) != '&') { builder.append(value.charAt(i)); continue; }
            int end = value.indexOf(';', i + 1);
            if (end < 0 || end - i > 10) { builder.append('&'); continue; }
            String token = value.substring(i + 1, end);
            if (token.startsWith("#")) {
                try {
                    int code = token.startsWith("#x") || token.startsWith("#X") ? Integer.parseInt(token.substring(2), 16) : Integer.parseInt(token.substring(1));
                    if (code > 0 && code < 1114112) builder.appendCodePoint(code);
                    i = end;
                    continue;
                } catch (NumberFormatException ignored) {}
            }
            switch (token) {
                case "amp" -> builder.append('&');
                case "lt" -> builder.append('<');
                case "gt" -> builder.append('>');
                case "quot" -> builder.append('"');
                case "apos", "#39" -> builder.append('\'');
                case "nbsp" -> builder.append(' ');
                default -> builder.append(value, i, end + 1);
            }
            i = end;
        }
        return builder.toString();
    }

    private static String initials(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.isEmpty()) return "?";
        String[] parts = trimmed.split("\\s+");
        String first = parts[0].substring(0, 1);
        String second = parts.length > 1 ? parts[parts.length - 1].substring(0, 1) : "";
        return (first + second).toUpperCase(Locale.FRENCH);
    }
}
