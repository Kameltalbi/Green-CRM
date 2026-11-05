package com.ciblix.crm;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Application;
import android.app.Dialog;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.InputType;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;

/** Photographier → prévisualiser → analyser → vérifier → enregistrer. La clé OCR reste sur le serveur. */
final class DocumentImportController {
    static final int REQ_CAMERA = 4101;
    static final int REQ_PICK = 4102;
    static final int REQ_CAMERA_PERM = 4103;
    private static final String STATE_PATH = "scanPath";
    private static final long PENDING_MAX_AGE_MS = 15 * 60 * 1000L;

    private final Activity activity;
    private final ApiClient api;
    private final ExecutorService worker;
    private final Runnable onSaved;
    private final UiKit ui;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSONObject> pages = new ArrayList<>();
    private Uri cameraUri;
    private File cameraFile;
    private Bitmap preview;
    private TextView statusView;
    private Dialog screen;
    private Runnable pendingUi;
    private boolean resumed;
    private boolean flushing;
    private boolean extracting;
    private String previewError = "";
    private int captureToken;
    private int consumedToken = -1;
    private boolean keepPhotoOnDismiss;
    private static boolean purgedThisProcess;

    DocumentImportController(Activity activity, ApiClient api, ExecutorService worker, Runnable onSaved) {
        this.activity = activity;
        this.api = api;
        this.worker = worker;
        this.onSaved = onSaved;
        this.ui = new UiKit(activity);
        purgeStaleCaptures();
        activity.getApplication().registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityDestroyed(Activity host) {
                if (host != activity) return;
                host.getApplication().unregisterActivityLifecycleCallbacks(this);
                if (host.isFinishing()) discardPhoto();
            }
            @Override public void onActivityCreated(Activity a, Bundle b) {}
            @Override public void onActivityStarted(Activity a) {}
            @Override public void onActivityResumed(Activity a) {}
            @Override public void onActivityPaused(Activity a) {}
            @Override public void onActivityStopped(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
        });
    }

    void attachStatus(TextView status) { this.statusView = status; }

    void saveState(Bundle state) {
        if (cameraFile != null) state.putString(STATE_PATH, cameraFile.getAbsolutePath());
    }

    void restoreState(Bundle state) {
        if (state == null) return;
        String path = state.getString(STATE_PATH);
        if (path != null && !path.isEmpty()) cameraFile = new File(path);
    }

    void onHostResume() {
        resumed = true;
        flushUi();
    }

    void onHostPause() { resumed = false; }

    void offerPendingCapture() {
        if (!pages.isEmpty() || screen != null) return;
        File file = rememberedFile();
        if (!usableFile(file)) return;
        if (System.currentTimeMillis() - file.lastModified() > PENDING_MAX_AGE_MS) {
            clearMarker();
            return;
        }
        try {
            addImageFile(file);
            showWhenReady(this::showPreview);
        } catch (Exception e) {
            report("Photo inutilisable", messageOf(e));
        }
    }

    void start(TextView status) {
        if (extracting) return;
        this.statusView = status;
        dismissKeepingPhoto();
        discardPhoto();
        setStatus("Vérification du service OCR…");
        worker.execute(() -> {
            try {
                JSONObject st = api.request("GET", "/api/v1/documents/import-status", null, 15000);
                boolean ready = st.optBoolean("configured", false);
                String notice = st.optString("notice", "");
                activity.runOnUiThread(() -> {
                    if (activity.isDestroyed()) return;
                    if (!ready) {
                        report("Scan indisponible", "Le serveur n’a pas de service d’analyse configuré. Aucune fiche n’a été créée.");
                        return;
                    }
                    setStatus("");
                    showWhenReady(() -> showCaptureSheet(notice));
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> report("Scan impossible", e instanceof java.io.IOException
                    ? "Serveur inaccessible. Vérifiez la connexion. Aucune fiche n’a été créée."
                    : messageOf(e)));
            }
        });
    }

    private void showCaptureSheet(String notice) {
        LinearLayout body = ui.column();
        body.setPadding(dp(4), dp(8), dp(4), dp(4));
        TextView info = ui.subtitle((notice == null || notice.isEmpty()
            ? "Photographier, vérifier, puis enregistrer."
            : notice)
            + "\nJPG, PNG, WebP ou PDF · 5 pages · 8 Mo.");
        body.addView(info);
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setTitle("Scanner une carte")
            .setView(body)
            .setNegativeButton("Annuler", null)
            .create();
        body.addView(ui.vivid("Appareil photo", UiKit.ORANGE, () -> {
            dialog.dismiss();
            openCamera();
        }));
        body.addView(ui.secondary("Galerie ou PDF", () -> {
            dialog.dismiss();
            openPicker();
        }));
        dialog.show();
    }

    private void openCamera() {
        if (Build.VERSION.SDK_INT >= 23 && activity.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_PERM);
            return;
        }
        try {
            cameraFile = new File(activity.getCacheDir(), "scan-" + System.currentTimeMillis() + ".jpg");
            if (!cameraFile.createNewFile() && !cameraFile.exists()) {
                report("Photo impossible", "Impossible de préparer le fichier photo.");
                return;
            }
            remember(cameraFile);
            cameraUri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", cameraFile);
            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            // Fichier du cache privé uniquement : aucune insertion MediaStore ni copie dans la galerie.
            intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            intent.setClipData(ClipData.newRawUri("scan", cameraUri));
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            List<ResolveInfo> targets = activity.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo info : targets) {
                activity.grantUriPermission(info.activityInfo.packageName, cameraUri,
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            captureToken++;
            activity.startActivityForResult(intent, REQ_CAMERA);
        } catch (android.content.ActivityNotFoundException e) {
            report("Appareil photo indisponible", "Aucune application d’appareil photo n’est installée. Choisissez une image dans la galerie.");
        } catch (Exception e) {
            report("Appareil photo", messageOf(e));
        }
    }

    private void openPicker() {
        try {
            captureToken++;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp", "application/pdf"});
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            activity.startActivityForResult(Intent.createChooser(intent, "Choisir une image"), REQ_PICK);
        } catch (android.content.ActivityNotFoundException e) {
            report("Galerie indisponible", "Aucune application ne peut ouvrir une image.");
        }
    }

    void onPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != REQ_CAMERA_PERM) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else report("Autorisation refusée", "L’appareil photo est refusé. Vous pouvez choisir une image dans la galerie. Aucune fiche n’a été créée.");
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_CAMERA && requestCode != REQ_PICK) return;
        if (requestCode == REQ_CAMERA && captureToken == 0 && !pages.isEmpty()) {
            showWhenReady(this::showPreview);
            return;
        }
        if (consumedToken == captureToken && captureToken != 0) return;
        consumedToken = captureToken;
        try {
            if (requestCode == REQ_CAMERA) {
                File file = rememberedFile();
                boolean wrote = usableFile(file);
                if (!wrote && data != null && data.getData() != null) {
                    addUri(data.getData());
                } else if (wrote) {
                    addImageFile(file);
                    deleteCurrentCameraFile();
                } else if (data != null && data.getExtras() != null && data.getExtras().get("data") instanceof Bitmap thumb) {
                    addBitmap(thumb, "image/jpeg");
                    setStatus("Photo reçue en basse résolution.");
                } else if (resultCode != Activity.RESULT_OK) {
                    deleteCurrentCameraFile();
                    if (pages.isEmpty()) {
                        report("Prise de vue annulée", "Aucune photo n’a été conservée. Reprenez la photo ou choisissez une image dans la galerie.");
                    } else {
                        showPreview();
                    }
                    return;
                } else {
                    deleteCurrentCameraFile();
                    report("Photo non enregistrée", "L’appareil photo s’est ouvert mais le fichier image est vide. Réessayez, ou choisissez la photo dans la galerie. Aucune fiche n’a été créée.");
                    return;
                }
            } else {
                if (resultCode != Activity.RESULT_OK || data == null) {
                    report("Sélection annulée", "Aucun fichier n’a été choisi.");
                    return;
                }
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    for (int i = 0; i < n; i++) addUri(data.getClipData().getItemAt(i).getUri());
                } else if (data.getData() != null) {
                    addUri(data.getData());
                } else {
                    report("Fichier vide", "L’image choisie est inaccessible.");
                    return;
                }
            }
            if (pages.isEmpty()) {
                report("Document illisible", "Aucun document exploitable. Reprenez la photo ou choisissez un autre fichier.");
                return;
            }
            if (cameraUri != null) {
                activity.revokeUriPermission(cameraUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            showWhenReady(this::showPreview);
        } catch (Exception e) {
            deleteCurrentCameraFile();
            report("Photo inutilisable", messageOf(e));
        }
    }

    private void showPreview() {
        LinearLayout body = ui.column();
        TextView help = ui.subtitle(pages.size() + " page(s) prête(s). Vérifiez la photo, puis lancez l’analyse. Rien n’est enregistré à cette étape.");
        help.setPadding(0, dp(8), 0, dp(8));
        body.addView(help);
        if (preview != null && !preview.isRecycled()) {
            ImageView image = new ImageView(activity);
            image.setImageBitmap(preview);
            image.setAdjustViewBounds(true);
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setContentDescription("Prévisualisation de la carte de visite");
            image.setBackgroundColor(UiKit.FIELD);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240));
            lp.bottomMargin = dp(8);
            image.setLayoutParams(lp);
            body.addView(image);
        } else {
            body.addView(ui.subtitle("Document prêt pour l’analyse (aperçu image indisponible)."));
        }
        CheckBox consent = new CheckBox(activity);
        consent.setChecked(false);
        consent.setText("Pour analyser cette carte de visite, Ciblix transmettra sa photographie à OpenAI afin d’en extraire les coordonnées professionnelles. Vérifiez les informations avant leur enregistrement.");
        consent.setTextColor(UiKit.PETROLEUM);
        body.addView(consent);
        LinearLayout footer = ui.column();
        TextView error = new TextView(activity);
        error.setTextColor(UiKit.DANGER);
        error.setTextSize(14);
        error.setText(previewError == null ? "" : previewError);
        error.setVisibility(blank(previewError) ? View.GONE : View.VISIBLE);
        footer.addView(error);
        Button analyze = ui.vivid(blank(previewError) ? "Analyser la carte" : "Réessayer l’analyse", UiKit.ORANGE, () -> {
            if (!consent.isChecked()) {
                error.setVisibility(View.VISIBLE);
                error.setText("Cochez l’accord pour lancer l’analyse. La photo n’est pas envoyée.");
                return;
            }
            extract();
        });
        footer.addView(analyze);
        footer.addView(ui.secondary("Saisir manuellement", () -> {
            try { showReview(new JSONObject()); }
            catch (Exception e) { report("Saisie impossible", messageOf(e)); }
        }));
        footer.addView(ui.secondary("Reprendre la photo", () -> {
            pages.clear();
            recyclePreview();
            dismissKeepingPhoto();
            deleteCurrentCameraFile();
            openCamera();
        }));
        footer.addView(ui.secondary("Choisir dans la galerie", () -> {
            pages.clear();
            recyclePreview();
            dismissKeepingPhoto();
            deleteCurrentCameraFile();
            openPicker();
        }));
        if (pages.size() < 5 && (pages.isEmpty() || !"application/pdf".equals(pages.get(0).optString("mime_type")))) {
            footer.addView(ui.secondary("Ajouter une page", () -> {
                dismissKeepingPhoto();
                openCamera();
            }));
        }
        footer.addView(ui.ghost("Annuler", () -> {
            dismissScreen();
            setStatus("Analyse annulée. La photo a été supprimée. Aucune fiche n’a été créée.");
        }));
        openScreen("Vérifier la photo", body, footer);
        setStatus("Photo prête. Lancez l’analyse ou reprenez-la.");
    }

    private void extract() {
        if (extracting) return;
        if (pages.isEmpty()) {
            previewError = "La photo n’est plus en mémoire. Reprenez-la ou choisissez-la dans la galerie. Aucune fiche n’a été créée.";
            showPreview();
            return;
        }
        extracting = true;
        previewError = "";
        setStatus("Analyse en cours…");
        AlertDialog progress = new AlertDialog.Builder(activity)
            .setTitle("Analyse OpenAI")
            .setMessage("Lecture de la carte par OpenAI. La photo n’est pas enregistrée. Elle reste disponible seulement si l’analyse échoue.")
            .setCancelable(false)
            .create();
        try {
            progress.show();
        } catch (Exception e) {
            extracting = false;
            previewError = "Impossible d’afficher la progression. Réessayez. La photo est conservée.";
            showPreview();
            return;
        }
        List<JSONObject> snapshot = new ArrayList<>(pages);
        dismissKeepingPhoto();
        worker.execute(() -> {
            try {
                JSONObject body = new JSONObject().put("external_processing_consent", true);
                if (snapshot.size() == 1) {
                    body.put("mime_type", snapshot.get(0).getString("mime_type"));
                    body.put("data", snapshot.get(0).getString("data"));
                } else {
                    JSONArray list = new JSONArray();
                    for (JSONObject page : snapshot) list.put(page);
                    body.put("pages", list);
                }
                JSONObject result = api.request("POST", "/api/v1/documents/extract", body, 90000);
                activity.runOnUiThread(() -> {
                    extracting = false;
                    discardPhoto();
                    if (activity.isDestroyed()) return;
                    try { progress.dismiss(); } catch (Exception ignored) {}
                    setStatus("Analyse terminée. La photo a été supprimée.");
                    try { showReview(result); }
                    catch (Exception e) { report("Résultat illisible", messageOf(e)); }
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> {
                    extracting = false;
                    if (activity.isDestroyed()) return;
                    try { progress.dismiss(); } catch (Exception ignored) {}
                    String message = e instanceof java.io.IOException
                        ? "Serveur inaccessible. Vérifiez la connexion, puis réessayez. La photo est conservée. Aucune fiche n’a été créée."
                        : messageOf(e);
                    previewError = message;
                    showPreview();
                    report("Analyse impossible", message);
                });
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
            companies.put(new JSONObject());
            contacts.put(new JSONObject());
        }
        companies = namedCompanies(companies, contacts);
        JSONObject matches = extracted.optJSONObject("matches");
        if (matches == null) matches = new JSONObject();

        LinearLayout body = ui.column();
        if (preview != null && !preview.isRecycled()) {
            ImageView image = new ImageView(activity);
            image.setImageBitmap(preview);
            image.setAdjustViewBounds(true);
            image.setContentDescription("Carte analysée");
            image.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(160)));
            body.addView(image);
        }
        TextView help = ui.subtitle(empty
            ? "Aucune information fiable n’a été lue. Complétez au moins le nom, ou reprenez la photo. Rien n’est enregistré tant que vous ne validez pas."
            : "Corrigez les champs. Ceux marqués « à vérifier » sont incertains. Les champs vides n’ont pas été inventés.");
        help.setPadding(0, dp(8), 0, dp(8));
        body.addView(help);

        List<Row> companyRows = new ArrayList<>();
        List<Row> contactRows = new ArrayList<>();
        body.addView(ui.caption("Entreprise"));
        for (int i = 0; i < companies.length(); i++) {
            JSONObject src = companies.getJSONObject(i);
            companyRows.add(addCompanyRow(body, src, matchItems(matches.optJSONArray("companies"), src.optString("name")), empty));
        }
        body.addView(ui.caption("Contact"));
        for (int i = 0; i < contacts.length(); i++) {
            JSONObject src = contacts.getJSONObject(i);
            contactRows.add(addContactRow(body, src, matchItems(matches.optJSONArray("contacts"), src.optString("name"))));
        }
        TextView error = new TextView(activity);
        error.setTextColor(UiKit.DANGER);
        error.setTextSize(14);
        LinearLayout footer = ui.column();
        footer.addView(error);
        Button save = ui.vivid("Enregistrer", UiKit.SAGE, null);
        footer.addView(save);
        footer.addView(ui.secondary("Reprendre la photo", () -> {
            dismissKeepingPhoto();
            openCamera();
        }));
        footer.addView(ui.ghost("Abandonner", () -> {
            dismissScreen();
            setStatus("Saisie abandonnée. Aucune fiche n’a été créée.");
        }));
        Dialog dialog = openScreen("Vérifier avant d’enregistrer", body, footer);
        save.setOnClickListener(v -> {
            try {
                JSONObject payload = buildPayload(companyRows, contactRows);
                save.setEnabled(false);
                error.setText("Enregistrement…");
                error.setTextColor(UiKit.PETROLEUM);
                worker.execute(() -> {
                    try {
                        JSONObject saved = api.request("POST", "/api/v1/documents/import", payload, 30000);
                        activity.runOnUiThread(() -> {
                            if (activity.isDestroyed()) return;
                            try { dialog.dismiss(); } catch (Exception ignored) {}
                            discardPhoto();
                            report("Enregistrement réussi", summary(saved));
                            onSaved.run();
                        });
                    } catch (Exception e) {
                        activity.runOnUiThread(() -> {
                            if (activity.isDestroyed()) return;
                            save.setEnabled(true);
                            error.setTextColor(UiKit.DANGER);
                            error.setText(messageOf(e));
                        });
                    }
                });
            } catch (Exception e) {
                error.setTextColor(UiKit.DANGER);
                error.setText(messageOf(e));
            }
        });
    }

    private String summary(JSONObject result) {
        StringBuilder sb = new StringBuilder();
        appendBucket(sb, result.optJSONObject("created"), "Créé");
        appendBucket(sb, result.optJSONObject("updated"), "Mis à jour");
        appendBucket(sb, result.optJSONObject("linked"), "Associé");
        if (sb.length() == 0) sb.append("Enregistrement terminé.\n");
        sb.append("La liste Contacts est actualisée.");
        return sb.toString().trim();
    }

    private void appendBucket(StringBuilder sb, JSONObject group, String label) {
        if (group == null) return;
        JSONArray companies = group.optJSONArray("companies");
        if (companies != null) {
            for (int i = 0; i < companies.length(); i++) {
                JSONObject row = companies.optJSONObject(i);
                String name = row == null ? "" : row.optString("name");
                if (!name.isEmpty()) sb.append(label).append(" · entreprise « ").append(name).append(" ».\n");
            }
        }
        JSONArray contacts = group.optJSONArray("contacts");
        if (contacts != null) {
            for (int i = 0; i < contacts.length(); i++) {
                JSONObject row = contacts.optJSONObject(i);
                if (row == null || row.optString("name").isEmpty()) continue;
                sb.append(label).append(" · contact « ").append(row.optString("name")).append(" »");
                if (!row.optString("company_id").isEmpty()) sb.append(", associé à son entreprise");
                sb.append(".\n");
            }
        }
    }

    private JSONArray matchItems(JSONArray groups, String name) throws Exception {
        JSONArray out = new JSONArray();
        if (groups == null || name == null || name.isEmpty()) return out;
        for (int i = 0; i < groups.length(); i++) {
            JSONObject group = groups.getJSONObject(i);
            if (!name.equals(group.optString("name"))) continue;
            JSONArray items = group.optJSONArray("items");
            if (items != null) return items;
        }
        return out;
    }

    private static final class Choice {
        final String id;
        final String action;
        Choice(String id, String action) { this.id = id; this.action = action; }
    }

    private static final class Row {
        final CheckBox select;
        final EditText[] fields;
        final Spinner action;
        final List<Choice> choices;
        Row(CheckBox select, EditText[] fields, Spinner action, List<Choice> choices) {
            this.select = select;
            this.fields = fields;
            this.action = action;
            this.choices = choices;
        }
        Choice choice() {
            int idx = action.getSelectedItemPosition();
            if (idx < 0 || idx >= choices.size()) return new Choice("", "create");
            return choices.get(idx);
        }
    }

    private Row addCompanyRow(LinearLayout body, JSONObject src, JSONArray matches, boolean empty) throws Exception {
        CheckBox select = new CheckBox(activity);
        boolean named = !src.optString("name").trim().isEmpty();
        select.setText(named ? "Enregistrer cette entreprise" : "Créer une entreprise");
        select.setChecked(named);
        select.setTextColor(UiKit.PETROLEUM);
        body.addView(select);
        if (matches != null && matches.length() > 0) {
            TextView hint = ui.subtitle("Une entreprise de ce nom existe déjà. Associez-la pour éviter un doublon.");
            hint.setTextColor(UiKit.WARN);
            body.addView(hint);
        }
        Set<String> unsure = unsure(src);
        String[] keys = {"name", "sector", "city", "address", "phone", "email", "website", "country", "linkedin", "description"};
        String[] labels = {"Nom", "Secteur", "Ville", "Adresse postale", "Téléphone", "E-mail", "Site web", "Pays", "LinkedIn", "À propos"};
        int[] types = {
            InputType.TYPE_CLASS_TEXT,
            InputType.TYPE_CLASS_TEXT,
            InputType.TYPE_CLASS_TEXT,
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE,
            InputType.TYPE_CLASS_PHONE,
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI,
            InputType.TYPE_CLASS_TEXT,
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI,
            InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE
        };
        EditText[] fields = new EditText[keys.length];
        for (int i = 0; i < keys.length; i++) {
            fields[i] = field(body, labels[i], src.optString(keys[i], ""), types[i], unsure.contains(keys[i]));
        }
        List<Choice> choices = new ArrayList<>();
        Spinner action = choiceSpinner(body, matches, choices, true);
        if (empty) select.setChecked(false);
        return new Row(select, fields, action, choices);
    }

    private Row addContactRow(LinearLayout body, JSONObject src, JSONArray matches) throws Exception {
        CheckBox select = new CheckBox(activity);
        select.setText("Enregistrer ce contact");
        select.setChecked(true);
        select.setTextColor(UiKit.PETROLEUM);
        body.addView(select);
        if (matches != null && matches.length() > 0) {
            TextView hint = ui.subtitle("Un contact correspondant existe déjà. Complétez-le pour éviter un doublon.");
            hint.setTextColor(UiKit.WARN);
            body.addView(hint);
        }
        String[] parts = splitName(src.optString("name", ""));
        String emails = joinEmails(src.optJSONArray("emails"));
        Set<String> unsure = unsure(src);
        EditText first = field(body, "Prénom", parts[0], InputType.TYPE_CLASS_TEXT, unsure.contains("name"));
        EditText last = field(body, "Nom", parts[1], InputType.TYPE_CLASS_TEXT, unsure.contains("name"));
        EditText job = field(body, "Fonction", src.optString("job_title", ""), InputType.TYPE_CLASS_TEXT, unsure.contains("job_title"));
        EditText department = field(body, "Service", src.optString("department", ""), InputType.TYPE_CLASS_TEXT, unsure.contains("department"));
        EditText phone = field(body, "Téléphone mobile", src.optString("phone", ""), InputType.TYPE_CLASS_PHONE, unsure.contains("phone"));
        EditText phoneWork = field(body, "Téléphone professionnel", src.optString("phone_work", ""), InputType.TYPE_CLASS_PHONE, unsure.contains("phone_work"));
        EditText whatsapp = field(body, "WhatsApp", src.optString("whatsapp", ""), InputType.TYPE_CLASS_PHONE, unsure.contains("whatsapp"));
        EditText email = field(body, "E-mails", emails, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE, unsure.contains("emails"));
        EditText companyName = field(body, "Entreprise", src.optString("company_name", ""), InputType.TYPE_CLASS_TEXT, unsure.contains("company_name"));
        List<Choice> choices = new ArrayList<>();
        Spinner action = choiceSpinner(body, matches, choices, false);
        return new Row(select, new EditText[]{first, last, job, department, phone, phoneWork, whatsapp, email, companyName}, action, choices);
    }

    private Spinner choiceSpinner(LinearLayout body, JSONArray matches, List<Choice> choices, boolean company) throws Exception {
        TextView label = ui.subtitle(company ? "Si l’entreprise existe déjà" : "Si le contact existe déjà");
        label.setPadding(0, dp(8), 0, dp(4));
        body.addView(label);
        List<String> labels = new ArrayList<>();
        labels.add(company ? "Créer une nouvelle entreprise" : "Créer un nouveau contact");
        choices.add(new Choice("", "create"));
        int select = 0;
        if (matches != null) {
            for (int i = 0; i < matches.length(); i++) {
                JSONObject match = matches.getJSONObject(i);
                String id = match.getString("id");
                String name = match.optString("name");
                if (company) {
                    labels.add("Associer « " + name + " » sans la modifier");
                    choices.add(new Choice(id, "link"));
                    labels.add("Compléter « " + name + " »");
                    choices.add(new Choice(id, "update"));
                    if (i == 0) select = 1;
                } else {
                    labels.add("Compléter « " + name + " »");
                    choices.add(new Choice(id, "update"));
                    if (i == 0) select = 1;
                }
            }
        }
        Spinner spinner = new Spinner(activity);
        spinner.setAdapter(new ArrayAdapter<>(activity, android.R.layout.simple_spinner_dropdown_item, labels));
        spinner.setSelection(select);
        body.addView(spinner);
        return spinner;
    }

    private EditText field(LinearLayout parent, String label, String value, int type, boolean uncertain) {
        TextView caption = ui.label(uncertain ? label + " · à vérifier" : label, 13, uncertain ? UiKit.WARN : UiKit.MUTED, false);
        caption.setPadding(0, dp(10), 0, dp(4));
        parent.addView(caption);
        EditText input = new EditText(activity);
        input.setText(value == null ? "" : value);
        input.setTextSize(16);
        input.setInputType(type);
        input.setTextColor(UiKit.PETROLEUM);
        input.setHintTextColor(UiKit.MUTED);
        input.setBackground(ui.round(UiKit.FIELD, 12));
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setMinHeight(dp(48));
        input.setContentDescription(label);
        if ((type & InputType.TYPE_TEXT_FLAG_MULTI_LINE) == 0) input.setSingleLine(true);
        parent.addView(input);
        return input;
    }

    private JSONObject buildPayload(List<Row> companies, List<Row> contacts) throws Exception {
        JSONArray companyOut = new JSONArray();
        JSONArray contactOut = new JSONArray();
        List<String[]> links = new ArrayList<>();
        for (Row row : companies) {
            if (!row.select.isChecked()) continue;
            String name = row.fields[0].getText().toString().trim();
            Choice choice = row.choice();
            if ("link".equals(choice.action)) {
                if (choice.id.isEmpty()) throw new Exception("Choisissez l’entreprise à associer.");
                links.add(new String[]{name.toLowerCase(), choice.id, name});
                continue;
            }
            if (name.isEmpty()) throw new Exception("Le nom de l’entreprise est obligatoire pour la créer.");
            JSONObject item = new JSONObject()
                .put("selected", true)
                .put("action", "update".equals(choice.action) ? "update" : "create")
                .put("name", name)
                .put("sector", text(row.fields[1]))
                .put("city", text(row.fields[2]))
                .put("address", text(row.fields[3]))
                .put("phone", text(row.fields[4]))
                .put("email", text(row.fields[5]))
                .put("website", text(row.fields[6]))
                .put("country", text(row.fields[7]))
                .put("linkedin", text(row.fields[8]))
                .put("description", text(row.fields[9]));
            if (!choice.id.isEmpty()) item.put("id", choice.id);
            companyOut.put(item);
        }
        for (Row row : contacts) {
            if (!row.select.isChecked()) continue;
            String name = (text(row.fields[0]) + " " + text(row.fields[1])).trim().replaceAll("\\s+", " ");
            if (name.isEmpty()) throw new Exception("Indiquez le prénom ou le nom du contact.");
            Choice choice = row.choice();
            JSONArray emails = new JSONArray();
            for (String part : row.fields[7].getText().toString().split("[\\n;,]")) {
                String email = part.trim();
                if (!email.isEmpty()) emails.put(email);
            }
            String companyName = text(row.fields[8]);
            JSONObject item = new JSONObject()
                .put("selected", true)
                .put("action", "update".equals(choice.action) ? "update" : "create")
                .put("name", name)
                .put("job_title", text(row.fields[2]))
                .put("department", text(row.fields[3]))
                .put("phone", text(row.fields[4]))
                .put("phone_work", text(row.fields[5]))
                .put("whatsapp", text(row.fields[6]))
                .put("emails", emails)
                .put("company_name", companyName)
                .put("source", "Carte de visite");
            if (!choice.id.isEmpty()) item.put("id", choice.id);
            for (String[] link : links) {
                if (companyName.isEmpty() || companyName.equalsIgnoreCase(link[2])) {
                    item.put("company_id", link[1]);
                    if (companyName.isEmpty()) item.put("company_name", link[2]);
                    break;
                }
            }
            contactOut.put(item);
        }
        if (companyOut.length() == 0 && contactOut.length() == 0) {
            throw new Exception("Sélectionnez au moins un contact ou une entreprise à enregistrer.");
        }
        return new JSONObject().put("companies", companyOut).put("contacts", contactOut);
    }

    private void addUri(Uri uri) throws Exception {
        ContentResolver resolver = activity.getContentResolver();
        String mime = resolver.getType(uri);
        if (mime == null) mime = "application/octet-stream";
        if ("application/pdf".equals(mime)) {
            if (!pages.isEmpty()) throw new Exception("Ajoutez soit un PDF, soit des photos.");
            byte[] bytes = readAll(resolver.openInputStream(uri));
            if (bytes.length == 0) throw new Exception("Le PDF est vide.");
            if (bytes.length > 8_388_608) throw new Exception("Le fichier dépasse 8 Mo.");
            pages.add(new JSONObject().put("mime_type", "application/pdf").put("data", base64(bytes)));
            return;
        }
        if (!mime.startsWith("image/")) throw new Exception("Formats acceptés : JPG, PNG, WebP ou PDF.");
        File temp = new File(activity.getCacheDir(), "import-" + System.currentTimeMillis() + ".img");
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) throw new Exception("Image inaccessible. Réessayez depuis la galerie.");
            try (OutputStream out = new FileOutputStream(temp)) {
                byte[] chunk = new byte[8192];
                int n;
                int total = 0;
                while ((n = in.read(chunk)) != -1) {
                    total += n;
                    if (total > 20_000_000) throw new Exception("L’image dépasse 20 Mo.");
                    out.write(chunk, 0, n);
                }
            }
        }
        try { addImageFile(temp); }
        finally { temp.delete(); }
    }

    private void addImageFile(File file) throws Exception {
        if (file == null || !file.isFile() || file.length() <= 0) {
            throw new Exception("La photo est vide. L’appareil photo n’a pas enregistré l’image.");
        }
        Bitmap bitmap = decodeOriented(file);
        if (bitmap == null) throw new Exception("Image illisible. Reprenez la photo ou choisissez un autre fichier.");
        addBitmap(bitmap, "image/jpeg");
    }

    private Bitmap decodeOriented(File file) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
        int sample = 1;
        int longest = Math.max(bounds.outWidth, bounds.outHeight);
        while (longest / sample > 4000) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = Math.max(1, sample);
        Bitmap bitmap = BitmapFactory.decodeFile(file.getAbsolutePath(), opts);
        if (bitmap == null) return null;
        int orientation = ExifInterface.ORIENTATION_UNDEFINED;
        try {
            orientation = new ExifInterface(file.getAbsolutePath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (Exception ignored) {}
        Matrix matrix = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90);
            case ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180);
            case ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270);
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1, 1);
            case ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1, -1);
            case ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90); matrix.preScale(-1, 1); }
            case ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270); matrix.preScale(-1, 1); }
            default -> { return bitmap; }
        }
        Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
        if (rotated != bitmap) bitmap.recycle();
        return rotated;
    }

    private void addBitmap(Bitmap bitmap, String mime) throws Exception {
        if (pages.size() >= 5) throw new Exception("Cinq pages maximum.");
        if (!pages.isEmpty() && "application/pdf".equals(pages.get(0).optString("mime_type"))) {
            throw new Exception("Un PDF est déjà sélectionné.");
        }
        Bitmap scaled = scale(bitmap, 3072);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (!scaled.compress(Bitmap.CompressFormat.JPEG, 90, out)) throw new Exception("Compression de la photo impossible.");
        byte[] bytes = out.toByteArray();
        if (bytes.length < 32 || bytes[0] != (byte) 0xFF || bytes[1] != (byte) 0xD8) {
            throw new Exception("La photo compressée est illisible.");
        }
        long total = bytes.length;
        for (JSONObject page : pages) total += Base64.decode(page.getString("data"), Base64.DEFAULT).length;
        if (total > 8_388_608) throw new Exception("Le total dépasse 8 Mo.");
        pages.add(new JSONObject().put("mime_type", "image/jpeg").put("data", base64(bytes)));
        if (preview != null && preview != scaled && preview != bitmap && !preview.isRecycled()) preview.recycle();
        preview = scaled;
        if (bitmap != scaled && !bitmap.isRecycled()) bitmap.recycle();
    }

    private static Bitmap scale(Bitmap src, int max) {
        int w = src.getWidth();
        int h = src.getHeight();
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

    private static String base64(byte[] bytes) {
        return Base64.encodeToString(bytes, Base64.NO_WRAP).replace("\n", "").replace("\r", "");
    }

    private static String[] splitName(String full) {
        String trimmed = full == null ? "" : full.trim();
        int space = trimmed.indexOf(' ');
        if (space < 0) return new String[]{trimmed, ""};
        return new String[]{trimmed.substring(0, space), trimmed.substring(space + 1).trim()};
    }

    private static String joinEmails(JSONArray list) {
        if (list == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < list.length(); i++) {
            if (i > 0) sb.append('\n');
            sb.append(list.optString(i));
        }
        return sb.toString();
    }

    private JSONArray namedCompanies(JSONArray companies, JSONArray contacts) throws Exception {
        JSONArray out = new JSONArray();
        Set<String> names = new HashSet<>();
        for (int i = 0; i < companies.length(); i++) {
            JSONObject company = companies.getJSONObject(i);
            String name = company.optString("name").trim();
            if (!name.isEmpty()) names.add(name.toLowerCase());
            out.put(company);
        }
        for (int i = 0; i < contacts.length(); i++) {
            String name = contacts.getJSONObject(i).optString("company_name").trim();
            if (name.isEmpty() || names.contains(name.toLowerCase())) continue;
            names.add(name.toLowerCase());
            out.put(new JSONObject().put("name", name));
        }
        return out;
    }

    private static Set<String> unsure(JSONObject src) {
        Set<String> out = new HashSet<>();
        JSONArray list = src.optJSONArray("uncertain");
        if (list == null) return out;
        for (int i = 0; i < list.length(); i++) out.add(list.optString(i));
        return out;
    }

    private static String text(EditText field) { return field.getText().toString().trim(); }

    private Dialog openScreen(String title, LinearLayout body, LinearLayout footer) {
        dismissScreen();
        Dialog dialog = new Dialog(activity, android.R.style.Theme_Light_NoTitleBar_Fullscreen);
        LinearLayout root = ui.column();
        root.setBackgroundColor(UiKit.BG);
        root.setFitsSystemWindows(true);
        root.setPadding(dp(16), dp(12), dp(16), dp(8));
        root.addView(ui.title(title));
        ScrollView scroll = new ScrollView(activity);
        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        if (footer != null) root.addView(footer);
        dialog.setContentView(root);
        dialog.setCancelable(true);
        screen = dialog;
        dialog.setOnDismissListener(d -> {
            if (screen == dialog) screen = null;
            if (!keepPhotoOnDismiss) discardPhoto();
        });
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
        return dialog;
    }

    private void dismissScreen() {
        if (screen == null) return;
        try { screen.dismiss(); } catch (Exception ignored) {}
        screen = null;
    }

    private void showWhenReady(Runnable uiAction) {
        pendingUi = uiAction;
        if (resumed) flushUi();
    }

    private void flushUi() {
        if (flushing) return;
        Runnable job = pendingUi;
        pendingUi = null;
        if (job == null || activity.isDestroyed()) return;
        flushing = true;
        try { job.run(); }
        catch (Exception e) { setStatus(messageOf(e)); }
        finally { flushing = false; }
        if (pendingUi != null) flushUi();
    }

    private void report(String title, String message) {
        String shown = blank(message) ? "Une erreur est survenue." : message;
        setStatus(shown);
        showWhenReady(() -> {
            if (activity.isDestroyed()) return;
            new AlertDialog.Builder(activity).setTitle(title).setMessage(shown).setPositiveButton("OK", null).show();
        });
    }

    private void setStatus(String message) {
        if (statusView != null) {
            boolean empty = message == null || message.trim().isEmpty();
            statusView.setText(empty ? "" : message);
            statusView.setVisibility(empty ? View.GONE : View.VISIBLE);
            statusView.setTextColor(UiKit.MUTED);
        }
    }

    private static boolean blank(String value) { return value == null || value.trim().isEmpty(); }

    private static String messageOf(Exception e) {
        String message = e.getMessage();
        if (blank(message)) return "Opération impossible. Aucune fiche n’a été créée.";
        return message;
    }

    private void remember(File file) {
        cameraFile = file;
        try {
            Files.write(marker().toPath(), file.getAbsolutePath().getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {}
    }

    private File rememberedFile() {
        if (usableFile(cameraFile)) return cameraFile;
        File marker = marker();
        if (!marker.isFile()) return cameraFile;
        try {
            String path = new String(Files.readAllBytes(marker.toPath()), StandardCharsets.UTF_8).trim();
            if (path.isEmpty()) return cameraFile;
            File file = new File(path);
            String cache = activity.getCacheDir().getCanonicalPath();
            if (!file.getCanonicalPath().startsWith(cache)) return null;
            cameraFile = file;
            return file;
        } catch (Exception e) {
            return cameraFile;
        }
    }

    private File marker() { return new File(activity.getCacheDir(), "pending-scan.txt"); }

    private void clearMarker() {
        marker().delete();
    }

    private static boolean usableFile(File file) {
        return file != null && file.isFile() && file.length() > 0;
    }

    private void dismissKeepingPhoto() {
        keepPhotoOnDismiss = true;
        dismissScreen();
        keepPhotoOnDismiss = false;
    }

    private void purgeStaleCaptures() {
        if (purgedThisProcess) return;
        purgedThisProcess = true;
        deleteCaptureFiles();
    }

    private void deleteCurrentCameraFile() {
        clearMarker();
        if (cameraFile != null && cameraFile.getName().startsWith("scan-")) cameraFile.delete();
        cameraFile = null;
        cameraUri = null;
    }

    private void deleteCaptureFiles() {
        clearMarker();
        File[] files = activity.getCacheDir().listFiles();
        if (files != null) {
            for (File file : files) {
                String name = file.getName();
                if (name.startsWith("scan-") || name.startsWith("import-") || "pending-scan.txt".equals(name)) file.delete();
            }
        }
        cameraFile = null;
        cameraUri = null;
    }

    private void discardPhoto() {
        pages.clear();
        recyclePreview();
        previewError = "";
        deleteCaptureFiles();
    }

    private void recyclePreview() {
        if (preview != null && !preview.isRecycled()) preview.recycle();
        preview = null;
    }

    private int dp(int value) { return ui.dp(value); }
}
