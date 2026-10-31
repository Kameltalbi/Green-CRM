package com.ciblix.crm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Base64;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;

/** Photographier → Vérifier → Enregistrer. La clé Gemini reste côté serveur. */
final class DocumentImportController {
    static final int REQ_CAMERA = 4101;
    static final int REQ_PICK = 4102;
    static final int REQ_CAMERA_PERM = 4103;

    private final Activity activity;
    private final ApiClient api;
    private final ExecutorService worker;
    private final Runnable onSaved;
    private final List<JSONObject> pages = new ArrayList<>();
    private Uri cameraUri;
    private File cameraFile;
    private TextView statusView;

    DocumentImportController(Activity activity, ApiClient api, ExecutorService worker, Runnable onSaved) {
        this.activity = activity;
        this.api = api;
        this.worker = worker;
        this.onSaved = onSaved;
    }

    void start(TextView status) {
        this.statusView = status;
        pages.clear();
        showCaptureSheet();
    }

    private int dp(int value) {
        return (int) (activity.getResources().getDisplayMetrics().density * value);
    }

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(activity);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private void showCaptureSheet() {
        LinearLayout body = column();
        body.setPadding(dp(20), dp(8), dp(20), dp(8));
        TextView info = new TextView(activity);
        info.setText("Photographier → Vérifier → Enregistrer\nJPG, PNG, WebP ou PDF · 5 pages · 8 Mo. Le document est envoyé à Ciblix (Gemini) uniquement après votre accord.");
        info.setTextSize(15);
        info.setTextColor(Color.rgb(31, 41, 55));
        body.addView(info);
        TextView count = new TextView(activity);
        count.setText(pages.isEmpty() ? "Aucune page sélectionnée." : pages.size() + " page(s) prête(s).");
        count.setTextSize(14);
        count.setPadding(0, dp(12), 0, dp(8));
        body.addView(count);
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setTitle("Scanner un document")
            .setView(body)
            .setNegativeButton("Annuler", null)
            .create();
        body.addView(button("Photographier", () -> {
            dialog.dismiss();
            openCamera();
        }));
        body.addView(button("Choisir image ou PDF", () -> {
            dialog.dismiss();
            openPicker();
        }));
        if (!pages.isEmpty()) {
            body.addView(button("Analyser (" + pages.size() + " page(s))", () -> {
                dialog.dismiss();
                confirmAndExtract();
            }));
            body.addView(button("Recommencer", () -> {
                pages.clear();
                dialog.dismiss();
                showCaptureSheet();
            }));
        }
        dialog.show();
    }

    private Button button(String label, Runnable action) {
        Button b = new Button(activity);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(v -> action.run());
        return b;
    }

    private void openCamera() {
        if (Build.VERSION.SDK_INT >= 23 && activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
            return;
        }
        try {
            cameraFile = new File(activity.getCacheDir(), "scan-" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(activity, "com.ciblix.crm.fileprovider", cameraFile);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivityForResult(intent, REQ_CAMERA);
        } catch (Exception e) {
            setStatus(e.getMessage());
        }
    }

    private void openPicker() {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp", "application/pdf"});
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        activity.startActivityForResult(Intent.createChooser(intent, "Choisir un document"), REQ_PICK);
    }

    void onPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != REQ_CAMERA_PERM) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else setStatus("Autorisation appareil photo refusée. Vous pouvez quand même choisir un fichier.");
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (resultCode != Activity.RESULT_OK) return;
        try {
            if (requestCode == REQ_CAMERA) {
                if (cameraFile == null || !cameraFile.exists()) {
                    setStatus("Photo introuvable.");
                    return;
                }
                addImageFile(cameraFile);
            } else if (requestCode == REQ_PICK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    for (int i = 0; i < n; i++) addUri(data.getClipData().getItemAt(i).getUri());
                } else if (data.getData() != null) {
                    addUri(data.getData());
                }
            }
            if (pages.isEmpty()) {
                setStatus("Aucun document lisible.");
                return;
            }
            showCaptureSheet();
        } catch (Exception e) {
            setStatus(e.getMessage());
        }
    }

    private void addUri(Uri uri) throws Exception {
        ContentResolver resolver = activity.getContentResolver();
        String mime = resolver.getType(uri);
        if (mime == null) mime = "application/octet-stream";
        if ("application/pdf".equals(mime)) {
            if (!pages.isEmpty()) throw new Exception("Ajoutez soit un PDF, soit des photos (pas les deux).");
            byte[] bytes = readAll(resolver.openInputStream(uri));
            if (bytes.length > 8_388_608) throw new Exception("Le fichier dépasse 8 Mo.");
            JSONObject page = new JSONObject();
            page.put("mime_type", "application/pdf");
            page.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            pages.add(page);
            return;
        }
        if (!(mime.startsWith("image/"))) throw new Exception("Formats acceptés : JPG, PNG, WebP ou PDF.");
        try (InputStream in = resolver.openInputStream(uri)) {
            addBitmap(BitmapFactory.decodeStream(in), mime);
        }
    }

    private void addImageFile(File file) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeFile(file.getAbsolutePath());
        if (bitmap == null) throw new Exception("Image illisible.");
        addBitmap(bitmap, "image/jpeg");
    }

    private void addBitmap(Bitmap bitmap, String mime) throws Exception {
        if (pages.size() >= 5) throw new Exception("Cinq pages maximum.");
        if (!pages.isEmpty() && "application/pdf".equals(pages.get(0).optString("mime_type"))) {
            throw new Exception("Un PDF est déjà sélectionné.");
        }
        Bitmap scaled = scale(bitmap, 1600);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        String outMime = "image/jpeg";
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)) throw new Exception("Compression impossible.");
        byte[] bytes = out.toByteArray();
        long total = bytes.length;
        for (JSONObject page : pages) total += Base64.decode(page.getString("data"), Base64.DEFAULT).length;
        if (total > 8_388_608) throw new Exception("Le total dépasse 8 Mo.");
        JSONObject page = new JSONObject();
        page.put("mime_type", outMime);
        page.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        pages.add(page);
        if (scaled != bitmap) scaled.recycle();
    }

    private static Bitmap scale(Bitmap src, int max) {
        int w = src.getWidth(), h = src.getHeight();
        int longest = Math.max(w, h);
        if (longest <= max) return src;
        float ratio = max / (float) longest;
        return Bitmap.createScaledBitmap(src, Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio)), true);
    }

    private static byte[] readAll(InputStream in) throws Exception {
        if (in == null) throw new Exception("Fichier inaccessible.");
        try (in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) != -1) out.write(chunk, 0, n);
            return out.toByteArray();
        }
    }

    private void confirmAndExtract() {
        CheckBox consent = new CheckBox(activity);
        consent.setText("J’accepte l’envoi du document à Google (Gemini) via Ciblix. Aucune fiche ne sera créée sans validation.");
        new AlertDialog.Builder(activity)
            .setTitle("Analyse du document")
            .setView(consent)
            .setNegativeButton("Annuler", null)
            .setPositiveButton("Analyser", (d, w) -> {
                if (!consent.isChecked()) {
                    setStatus("Cochez l’accord d’envoi pour continuer.");
                    return;
                }
                extract();
            })
            .show();
    }

    private void extract() {
        setStatus("Analyse en cours…");
        worker.execute(() -> {
            try {
                JSONObject body = new JSONObject().put("external_processing_consent", true);
                if (pages.size() == 1) {
                    body.put("mime_type", pages.get(0).getString("mime_type"));
                    body.put("data", pages.get(0).getString("data"));
                } else {
                    JSONArray list = new JSONArray();
                    for (JSONObject page : pages) list.put(page);
                    body.put("pages", list);
                }
                JSONObject result = api.request("POST", "/api/v1/documents/extract", body, 90000);
                activity.runOnUiThread(() -> {
                    if (activity.isDestroyed()) return;
                    setStatus("");
                    try { showReview(result); }
                    catch (Exception e) { setStatus(e.getMessage()); }
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> setStatus(e instanceof java.io.IOException
                    ? "Serveur inaccessible. Vérifiez la connexion."
                    : e.getMessage()));
            }
        });
    }

    private void showReview(JSONObject extracted) throws Exception {
        JSONArray companies = extracted.optJSONArray("companies");
        JSONArray contacts = extracted.optJSONArray("contacts");
        if (companies == null) companies = new JSONArray();
        if (contacts == null) contacts = new JSONArray();
        boolean empty = companies.length() == 0 && contacts.length() == 0;
        if (empty) {
            companies.put(new JSONObject().put("name", "").put("sector", "").put("city", "").put("description", "")
                .put("address", "").put("phone", "").put("email", "").put("website", ""));
            contacts.put(new JSONObject().put("name", "").put("job_title", "").put("phone", "")
                .put("emails", new JSONArray()).put("company_name", ""));
        }
        JSONObject matches = extracted.optJSONObject("matches");
        if (matches == null) matches = new JSONObject();

        LinearLayout body = column();
        body.setPadding(dp(16), dp(8), dp(16), dp(8));
        TextView help = new TextView(activity);
        help.setText(empty
            ? "Aucun nom reconnu. Saisissez manuellement au moins le nom."
            : "Seul le nom est obligatoire. Corrigez puis enregistrez.");
        help.setTextSize(14);
        help.setPadding(0, 0, 0, dp(8));
        body.addView(help);

        List<Row> companyRows = new ArrayList<>();
        List<Row> contactRows = new ArrayList<>();
        TextView companyTitle = new TextView(activity);
        companyTitle.setText("Entreprises");
        companyTitle.setTypeface(null, Typeface.BOLD);
        companyTitle.setTextSize(18);
        body.addView(companyTitle);
        for (int i = 0; i < companies.length(); i++) {
            companyRows.add(addCompanyRow(body, companies.getJSONObject(i), matchItems(matches.optJSONArray("companies"), companies.getJSONObject(i).optString("name"))));
        }
        TextView contactTitle = new TextView(activity);
        contactTitle.setText("Contacts");
        contactTitle.setTypeface(null, Typeface.BOLD);
        contactTitle.setTextSize(18);
        contactTitle.setPadding(0, dp(12), 0, 0);
        body.addView(contactTitle);
        for (int i = 0; i < contacts.length(); i++) {
            contactRows.add(addContactRow(body, contacts.getJSONObject(i), matchItems(matches.optJSONArray("contacts"), contacts.getJSONObject(i).optString("name"))));
        }
        TextView error = new TextView(activity);
        error.setTextColor(Color.rgb(153, 27, 27));
        error.setTextSize(14);
        body.addView(error);
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(body);
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setTitle("Vérifier avant d’enregistrer")
            .setView(scroll)
            .setNegativeButton("Annuler", null)
            .setPositiveButton("Enregistrer", null)
            .create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                JSONObject payload = buildPayload(companyRows, contactRows);
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
                error.setText("Enregistrement…");
                worker.execute(() -> {
                    try {
                        api.request("POST", "/api/v1/documents/import", payload, 30000);
                        activity.runOnUiThread(() -> {
                            if (activity.isDestroyed()) return;
                            dialog.dismiss();
                            pages.clear();
                            setStatus("Fiches enregistrées.");
                            onSaved.run();
                        });
                    } catch (Exception e) {
                        activity.runOnUiThread(() -> {
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                            error.setText(e.getMessage());
                        });
                    }
                });
            } catch (Exception e) {
                error.setText(e.getMessage());
            }
        }));
        dialog.show();
    }

    private JSONArray matchItems(JSONArray groups, String name) throws Exception {
        JSONArray out = new JSONArray();
        if (groups == null) return out;
        for (int i = 0; i < groups.length(); i++) {
            JSONObject group = groups.getJSONObject(i);
            if (!name.equals(group.optString("name"))) continue;
            JSONArray items = group.optJSONArray("items");
            if (items != null) return items;
        }
        return out;
    }

    private static final class Row {
        final CheckBox select;
        final EditText[] fields;
        final Spinner action;
        final List<String> matchIds;
        final boolean company;
        Row(CheckBox select, EditText[] fields, Spinner action, List<String> matchIds, boolean company) {
            this.select = select;
            this.fields = fields;
            this.action = action;
            this.matchIds = matchIds;
            this.company = company;
        }
    }

    private Row addCompanyRow(LinearLayout body, JSONObject src, JSONArray matches) throws Exception {
        CheckBox select = new CheckBox(activity);
        select.setText("Enregistrer cette entreprise");
        select.setChecked(true);
        body.addView(select);
        String[] keys = {"name", "sector", "city", "address", "phone", "email", "website", "description"};
        String[] labels = {"Nom *", "Secteur", "Ville", "Adresse", "Téléphone", "E-mail", "Site web", "À propos"};
        EditText[] fields = new EditText[keys.length];
        for (int i = 0; i < keys.length; i++) {
            fields[i] = field(body, labels[i], src.optString(keys[i], ""), i == 7 ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE : InputType.TYPE_CLASS_TEXT);
        }
        List<String> ids = new ArrayList<>();
        Spinner action = actionSpinner(body, matches, ids);
        return new Row(select, fields, action, ids, true);
    }

    private Row addContactRow(LinearLayout body, JSONObject src, JSONArray matches) throws Exception {
        CheckBox select = new CheckBox(activity);
        select.setText("Enregistrer ce contact");
        select.setChecked(true);
        body.addView(select);
        String emails = "";
        JSONArray list = src.optJSONArray("emails");
        if (list != null) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < list.length(); i++) {
                if (i > 0) sb.append('\n');
                sb.append(list.optString(i));
            }
            emails = sb.toString();
        }
        EditText name = field(body, "Nom *", src.optString("name", ""), InputType.TYPE_CLASS_TEXT);
        EditText job = field(body, "Fonction", src.optString("job_title", ""), InputType.TYPE_CLASS_TEXT);
        EditText phone = field(body, "Téléphone", src.optString("phone", ""), InputType.TYPE_CLASS_PHONE);
        EditText email = field(body, "E-mails", emails, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
        EditText companyName = field(body, "Entreprise (nom)", src.optString("company_name", ""), InputType.TYPE_CLASS_TEXT);
        List<String> ids = new ArrayList<>();
        Spinner action = actionSpinner(body, matches, ids);
        return new Row(select, new EditText[]{name, job, phone, email, companyName}, action, ids, false);
    }

    private Spinner actionSpinner(LinearLayout body, JSONArray matches, List<String> ids) throws Exception {
        TextView label = new TextView(activity);
        label.setText("Action");
        label.setTextSize(14);
        body.addView(label);
        List<String> labels = new ArrayList<>();
        labels.add("Créer une nouvelle fiche");
        ids.add("");
        if (matches != null) {
            for (int i = 0; i < matches.length(); i++) {
                JSONObject m = matches.getJSONObject(i);
                labels.add("Compléter « " + m.optString("name") + " »");
                ids.add(m.getString("id"));
            }
        }
        Spinner spinner = new Spinner(activity);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(activity, android.R.layout.simple_spinner_dropdown_item, labels);
        spinner.setAdapter(adapter);
        if (ids.size() > 1) spinner.setSelection(1);
        body.addView(spinner);
        return spinner;
    }

    private EditText field(LinearLayout parent, String label, String value, int type) {
        TextView t = new TextView(activity);
        t.setText(label);
        t.setTextSize(14);
        parent.addView(t);
        EditText e = new EditText(activity);
        e.setText(value);
        e.setTextSize(16);
        e.setInputType(type);
        if ((type & InputType.TYPE_TEXT_FLAG_MULTI_LINE) == 0) e.setSingleLine(true);
        parent.addView(e);
        return e;
    }

    private JSONObject buildPayload(List<Row> companies, List<Row> contacts) throws Exception {
        JSONArray companyOut = new JSONArray();
        JSONArray contactOut = new JSONArray();
        for (Row row : companies) {
            if (!row.select.isChecked()) continue;
            String name = row.fields[0].getText().toString().trim();
            if (name.isEmpty()) throw new Exception("Le nom de l’entreprise est obligatoire.");
            int idx = row.action.getSelectedItemPosition();
            String id = idx >= 0 && idx < row.matchIds.size() ? row.matchIds.get(idx) : "";
            JSONObject item = new JSONObject()
                .put("selected", true)
                .put("action", id.isEmpty() ? "create" : "update")
                .put("name", name)
                .put("sector", row.fields[1].getText().toString().trim())
                .put("city", row.fields[2].getText().toString().trim())
                .put("address", row.fields[3].getText().toString().trim())
                .put("phone", row.fields[4].getText().toString().trim())
                .put("email", row.fields[5].getText().toString().trim())
                .put("website", row.fields[6].getText().toString().trim())
                .put("description", row.fields[7].getText().toString().trim());
            if (!id.isEmpty()) item.put("id", id);
            companyOut.put(item);
        }
        for (Row row : contacts) {
            if (!row.select.isChecked()) continue;
            String name = row.fields[0].getText().toString().trim();
            if (name.isEmpty()) throw new Exception("Le nom du contact est obligatoire.");
            int idx = row.action.getSelectedItemPosition();
            String id = idx >= 0 && idx < row.matchIds.size() ? row.matchIds.get(idx) : "";
            JSONArray emails = new JSONArray();
            for (String part : row.fields[3].getText().toString().split("[\\n;,]")) {
                String email = part.trim();
                if (!email.isEmpty()) emails.put(email);
            }
            JSONObject item = new JSONObject()
                .put("selected", true)
                .put("action", id.isEmpty() ? "create" : "update")
                .put("name", name)
                .put("job_title", row.fields[1].getText().toString().trim())
                .put("phone", row.fields[2].getText().toString().trim())
                .put("emails", emails)
                .put("company_name", row.fields[4].getText().toString().trim());
            if (!id.isEmpty()) item.put("id", id);
            contactOut.put(item);
        }
        if (companyOut.length() == 0 && contactOut.length() == 0) {
            throw new Exception("Sélectionnez au moins une fiche à enregistrer.");
        }
        return new JSONObject().put("companies", companyOut).put("contacts", contactOut);
    }

    private void setStatus(String message) {
        if (statusView != null) statusView.setText(message == null ? "" : message);
    }
}
