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
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
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

/** Scanner ouvre l’appareil photo. La photo lance la lecture. Une seule confirmation : enregistrer. */
final class DocumentImportController {
    private static final String PROGRESS_LABEL = "Analyse en cours…";
    static final int REQ_CAMERA = 4101;
    static final int REQ_PICK = 4102;
    static final int REQ_CAMERA_PERM = 4103;
    private static final String STATE_PATH = "scanPath";

    private final Activity activity;
    private final ApiClient api;
    private final ExecutorService worker;
    private final Runnable onSaved;
    private final UiKit ui;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<JSONObject> pages = new ArrayList<>();
    private Uri cameraUri;
    private File cameraFile;
    private TextView statusView;
    private Dialog screen;
    private Dialog progressDialog;
    private ProgressBar progressBar;
    private Runnable progressTick;
    private int shownPercent;
    private Runnable pendingUi;
    private boolean resumed;
    private boolean flushing;
    private boolean extracting;
    private boolean analysisQueued;
    private boolean awaitingResultUi;
    private int captureToken;
    private int consumedToken = -1;
    private int analysisGeneration;
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
                if (host.isFinishing()) {
                    analysisGeneration++;
                    extracting = false;
                    analysisQueued = false;
                    awaitingResultUi = false;
                    dismissProgress();
                    discardPhoto();
                }
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
        if (cameraFile != null && !extracting) state.putString(STATE_PATH, cameraFile.getAbsolutePath());
    }

    void restoreState(Bundle state) {
        if (state == null || extracting || analysisQueued) return;
        String path = state.getString(STATE_PATH);
        if (path != null && !path.isEmpty()) cameraFile = new File(path);
    }

    void onHostResume() {
        resumed = true;
        flushUi();
    }

    void onHostPause() { resumed = false; }

    /** Une photo laissée par un ancien parcours est supprimée. Elle ne relance pas d’analyse. */
    void offerPendingCapture() {
        if (extracting || analysisQueued || awaitingResultUi || !pages.isEmpty() || screen != null) return;
        deleteCaptureFiles();
    }

    void start(TextView status) {
        if (extracting || analysisQueued || awaitingResultUi) return;
        this.statusView = status;
        dismissKeepingPhoto();
        dismissProgress();
        discardPhoto();
        setStatus("");
        openCamera();
    }

    private void openCamera() {
        if (extracting || analysisQueued) return;
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
        if (extracting || analysisQueued) return;
        try {
            captureToken++;
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"});
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            activity.startActivityForResult(Intent.createChooser(intent, "Choisir une image"), REQ_PICK);
        } catch (android.content.ActivityNotFoundException e) {
            report("Galerie indisponible", "Aucune application ne peut ouvrir une image.");
        }
    }

    void onPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != REQ_CAMERA_PERM || extracting || analysisQueued) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) openCamera();
        else report("Autorisation refusée", "L’appareil photo est nécessaire pour scanner une carte. Aucune fiche n’a été créée.");
    }

    void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_CAMERA && requestCode != REQ_PICK) return;
        if (extracting || analysisQueued) return;
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
                } else if (data != null && data.getExtras() != null && data.getExtras().get("data") instanceof Bitmap thumb) {
                    addBitmap(thumb, "image/jpeg");
                } else if (resultCode != Activity.RESULT_OK) {
                    deleteCurrentCameraFile();
                    report("Prise de vue annulée", "Aucune photo n’a été conservée.");
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
            if (cameraUri != null) {
                activity.revokeUriPermission(cameraUri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
            scheduleAnalysis();
        } catch (Exception e) {
            deleteCurrentCameraFile();
            wipeImage();
            report("Photo inutilisable", messageOf(e));
        }
    }

    private void scheduleAnalysis() {
        if (extracting || analysisQueued) return;
        if (pages.isEmpty()) {
            deleteCaptureFiles();
            showFailure("Aucun document exploitable. Reprenez la photo ou saisissez les informations. Aucune fiche n’a été créée.");
            return;
        }
        analysisQueued = true;
        deleteCaptureFiles();
        showWhenReady(this::beginAnalysis);
    }

    private void beginAnalysis() {
        if (extracting) return;
        if (pages.isEmpty()) {
            analysisQueued = false;
            showFailure("La photo n’est plus disponible. Reprenez-la ou saisissez les informations. Aucune fiche n’a été créée.");
            return;
        }
        extracting = true;
        analysisQueued = false;
        final int generation = ++analysisGeneration;
        final List<JSONObject> snapshot = new ArrayList<>(pages);
        deleteCaptureFiles();
        showProgress(generation);
        worker.execute(() -> {
            JSONObject body = null;
            try {
                body = requestBody(snapshot);
                final int[] sentPercent = {-1};
                JSONObject result = api.request("POST", "/api/v1/documents/extract", body, 90000, (sent, total) -> {
                    if (total <= 0) return;
                    int mapped = 12 + (int) (sent * 33L / total);
                    if (mapped == sentPercent[0]) return;
                    sentPercent[0] = mapped;
                    activity.runOnUiThread(() -> {
                        if (generation != analysisGeneration) return;
                        publishPercent(mapped);
                    });
                });
                JSONObject delivered = result;
                activity.runOnUiThread(() -> deliver(generation, delivered, null));
            } catch (Exception e) {
                activity.runOnUiThread(() -> deliver(generation, null, e));
            } finally {
                scrub(body);
                activity.runOnUiThread(this::deleteCaptureFiles);
            }
        });
    }

    private void deliver(int generation, JSONObject result, Exception error) {
        if (generation != analysisGeneration) return;
        if (activity.isDestroyed()) {
            extracting = false;
            dismissProgress();
            wipeImage();
            return;
        }
        if (error == null && progressBar != null) {
            publishPercent(100);
            main.postDelayed(() -> finishDelivery(generation, result, null), 320);
            return;
        }
        finishDelivery(generation, result, error);
    }

    private void finishDelivery(int generation, JSONObject result, Exception error) {
        if (generation != analysisGeneration) return;
        extracting = false;
        dismissProgress();
        if (activity.isDestroyed()) {
            wipeImage();
            return;
        }
        awaitingResultUi = true;
        showWhenReady(() -> present(generation, result, error));
    }

    private void present(int generation, JSONObject result, Exception error) {
        if (generation != analysisGeneration) return;
        awaitingResultUi = false;
        if (activity.isDestroyed()) {
            wipeImage();
            return;
        }
        if (error != null) {
            String message = error instanceof java.io.IOException
                ? "Serveur inaccessible. Vérifiez la connexion, puis réessayez. Aucune fiche n’a été créée."
                : messageOf(error);
            showFailure(message);
            return;
        }
        wipeImage();
        setStatus("");
        try { showReview(result == null ? new JSONObject() : result); }
        catch (Exception e) { report("Résultat illisible", messageOf(e)); }
    }

    private JSONObject requestBody(List<JSONObject> snapshot) throws Exception {
        JSONObject body = new JSONObject().put("external_processing_consent", true);
        if (snapshot.size() == 1) {
            body.put("mime_type", snapshot.get(0).getString("mime_type"));
            body.put("data", snapshot.get(0).getString("data"));
        } else {
            JSONArray list = new JSONArray();
            for (JSONObject page : snapshot) {
                list.put(new JSONObject()
                    .put("mime_type", page.getString("mime_type"))
                    .put("data", page.getString("data")));
            }
            body.put("pages", list);
        }
        return body;
    }

    private static void scrub(JSONObject body) {
        if (body == null) return;
        body.remove("data");
        JSONArray sent = body.optJSONArray("pages");
        if (sent == null) return;
        for (int i = 0; i < sent.length(); i++) {
            JSONObject page = sent.optJSONObject(i);
            if (page != null) page.remove("data");
        }
    }

    private void showProgress(int generation) {
        dismissProgress();
        shownPercent = 0;
        LinearLayout box = new LinearLayout(activity);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(18), dp(20), dp(8));
        TextView label = new TextView(activity);
        label.setText(PROGRESS_LABEL);
        label.setTextColor(UiKit.PETROLEUM);
        label.setTextSize(16);
        label.setGravity(Gravity.CENTER);
        label.setContentDescription(PROGRESS_LABEL);
        box.addView(label);
        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setProgress(0);
        bar.setIndeterminate(false);
        LinearLayout.LayoutParams barParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(4));
        barParams.topMargin = dp(14);
        box.addView(bar, barParams);
        progressBar = bar;
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setView(box)
            .setCancelable(false)
            .create();
        progressDialog = dialog;
        try {
            dialog.show();
            setStatus("");
        } catch (Exception e) {
            progressDialog = null;
            progressBar = null;
            setStatus(PROGRESS_LABEL);
        }
        startProgressLoop(generation);
    }

    private void startProgressLoop(int generation) {
        stopProgressLoop();
        progressTick = new Runnable() {
            @Override public void run() {
                if (generation != analysisGeneration || shownPercent >= 92) return;
                publishPercent(Math.min(92, shownPercent + 1));
                if (shownPercent < 92 && generation == analysisGeneration) main.postDelayed(this, 180);
            }
        };
        main.post(progressTick);
    }

    private void stopProgressLoop() {
        if (progressTick != null) main.removeCallbacks(progressTick);
        progressTick = null;
    }

    private void publishPercent(int value) {
        int next = Math.max(shownPercent, Math.max(0, Math.min(100, value)));
        if (next == shownPercent && (progressBar != null || next == 0)) return;
        shownPercent = next;
        if (progressBar != null) progressBar.setProgress(shownPercent);
        else if (progressDialog == null) setStatus(PROGRESS_LABEL);
    }

    private void showFailure(String message) {
        LinearLayout body = ui.column();
        TextView help = ui.subtitle(blank(message) ? "L’analyse a échoué. Aucune fiche n’a été créée." : message);
        help.setPadding(0, dp(12), 0, dp(8));
        body.addView(help);
        LinearLayout footer = ui.column();
        footer.addView(ui.vivid("Réessayer", UiKit.ORANGE, () -> {
            if (extracting || analysisQueued) return;
            analysisQueued = true;
            keepPhotoOnDismiss = true;
            dismissScreen();
            keepPhotoOnDismiss = false;
            beginAnalysis();
        }));
        footer.addView(ui.secondary("Reprendre la photo", () -> {
            if (extracting || analysisQueued) return;
            analysisGeneration++;
            wipeImage();
            dismissKeepingPhoto();
            openCamera();
        }));
        footer.addView(ui.secondary("Saisir manuellement", () -> {
            if (extracting || analysisQueued) return;
            analysisGeneration++;
            wipeImage();
            dismissKeepingPhoto();
            try { showReview(new JSONObject()); }
            catch (Exception e) { report("Saisie impossible", messageOf(e)); }
        }));
        deleteCaptureFiles();
        openScreen("Analyse impossible", body, footer);
        setStatus("");
    }

    private void showReview(JSONObject extracted) throws Exception {
        JSONArray companies = extracted.optJSONArray("companies");
        JSONArray contacts = extracted.optJSONArray("contacts");
        if (companies == null) companies = new JSONArray();
        if (contacts == null) contacts = new JSONArray();
        boolean empty = companies.length() == 0 && contacts.length() == 0;
        companies = namedCompanies(companies, contacts);
        JSONObject contact = contacts.length() == 0 ? new JSONObject() : contacts.getJSONObject(0);
        String[] parts = splitName(contact.optString("name", ""));
        String companyName = contact.optString("company_name", "").trim();
        JSONObject company = new JSONObject();
        for (int i = 0; i < companies.length(); i++) {
            JSONObject item = companies.getJSONObject(i);
            String name = item.optString("name", "").trim();
            if (companyName.isEmpty()) companyName = name;
            if (!name.isEmpty() && name.equalsIgnoreCase(companyName)) {
                company = item;
                break;
            }
        }
        String address = company.optString("address", "");
        String website = company.optString("website", "");
        JSONObject matches = extracted.optJSONObject("matches");
        if (matches == null) matches = new JSONObject();
        JSONArray companyMatches = matchItems(matches.optJSONArray("companies"), company.optString("name", companyName));
        JSONArray contactMatches = matchItems(matches.optJSONArray("contacts"), contact.optString("name", ""));
        Set<String> contactUnsure = unsure(contact);
        Set<String> companyUnsure = unsure(company);
        String phone = firstFilled(contact, "phone", "phone_work", "whatsapp");
        boolean phoneUnsure = contactUnsure.contains("phone") || (phone.equals(contact.optString("phone_work")) && contactUnsure.contains("phone_work"));

        LinearLayout body = ui.column();
        TextView help = ui.subtitle(empty
            ? "Aucune information fiable n’a été lue. Complétez les champs, puis enregistrez. Rien n’est conservé avant cette confirmation."
            : "Corrigez les informations si besoin. Elles ne sont enregistrées qu’au moment où vous confirmez.");
        help.setPadding(0, dp(8), 0, dp(8));
        body.addView(help);

        EditText last = field(body, "Nom", parts[1], InputType.TYPE_CLASS_TEXT, contactUnsure.contains("name"));
        EditText first = field(body, "Prénom", parts[0], InputType.TYPE_CLASS_TEXT, contactUnsure.contains("name"));
        EditText companyField = field(body, "Entreprise", companyName, InputType.TYPE_CLASS_TEXT, contactUnsure.contains("company_name") || companyUnsure.contains("name"));
        EditText job = field(body, "Fonction", contact.optString("job_title", ""), InputType.TYPE_CLASS_TEXT, contactUnsure.contains("job_title"));
        EditText phoneField = field(body, "Téléphone", phone, InputType.TYPE_CLASS_PHONE, phoneUnsure);
        EditText email = field(body, "E-mail", joinEmails(contact.optJSONArray("emails")), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS, contactUnsure.contains("emails"));
        EditText addressField = field(body, "Adresse", address, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE, companyUnsure.contains("address"));
        EditText websiteField = field(body, "Site web", website, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI, companyUnsure.contains("website"));

        List<Choice> companyChoices = new ArrayList<>();
        Spinner companyAction = null;
        if (companyMatches.length() > 0) {
            TextView hint = ui.subtitle("Une entreprise de ce nom existe déjà. Associez-la ou complétez-la pour éviter un doublon.");
            hint.setTextColor(UiKit.WARN);
            body.addView(hint);
            companyAction = choiceSpinner(body, companyMatches, companyChoices, true, true);
        }
        List<Choice> contactChoices = new ArrayList<>();
        Spinner contactAction = null;
        if (contactMatches.length() > 0) {
            TextView hint = ui.subtitle("Un contact correspondant existe déjà. Complétez-le pour éviter un doublon.");
            hint.setTextColor(UiKit.WARN);
            body.addView(hint);
            contactAction = choiceSpinner(body, contactMatches, contactChoices, false, true);
        }

        TextView error = new TextView(activity);
        error.setTextColor(UiKit.DANGER);
        error.setTextSize(14);
        LinearLayout footer = ui.column();
        footer.addView(error);
        Button save = ui.vivid("Enregistrer le contact", UiKit.PETROLEUM, null);
        footer.addView(save);
        footer.addView(ui.ghost("Abandonner", () -> {
            dismissScreen();
            setStatus("Saisie abandonnée. Aucune fiche n’a été créée.");
        }));
        Dialog dialog = openScreen("Contact", body, footer);
        Spinner companySpinner = companyAction;
        Spinner contactSpinner = contactAction;
        save.setOnClickListener(v -> {
            if (!save.isEnabled()) return;
            try {
                JSONObject payload = buildPayload(first, last, companyField, job, phoneField, email, addressField, websiteField, companySpinner, companyChoices, contactSpinner, contactChoices);
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
                save.setEnabled(true);
                error.setTextColor(UiKit.DANGER);
                error.setText(messageOf(e));
            }
        });
    }

    private JSONObject buildPayload(EditText firstField, EditText lastField, EditText companyField, EditText jobField, EditText phoneField, EditText emailField, EditText addressField, EditText websiteField, Spinner companySpinner, List<Choice> companyChoices, Spinner contactSpinner, List<Choice> contactChoices) throws Exception {
        String person = (text(firstField) + " " + text(lastField)).trim().replaceAll("\\s+", " ");
        if (person.isEmpty()) throw new Exception("Indiquez le prénom ou le nom du contact.");
        String companyName = text(companyField);
        String address = text(addressField);
        String website = text(websiteField);
        if (companyName.isEmpty() && (!address.isEmpty() || !website.isEmpty())) throw new Exception("Indiquez l’entreprise pour enregistrer l’adresse ou le site web.");
        JSONArray companyOut = new JSONArray();
        String linkedCompanyId = "";
        if (!companyName.isEmpty()) {
            Choice choice = selected(companySpinner, companyChoices);
            JSONObject item = new JSONObject().put("selected", true).put("name", companyName);
            if ("link".equals(choice.action)) {
                if (choice.id.isEmpty()) throw new Exception("Choisissez l’entreprise à associer.");
                linkedCompanyId = choice.id;
                item.put("action", "link").put("id", choice.id);
            } else {
                item.put("action", "update".equals(choice.action) ? "update" : "create").put("address", address).put("website", website);
                if (!choice.id.isEmpty()) item.put("id", choice.id);
            }
            companyOut.put(item);
        }
        Choice contactChoice = selected(contactSpinner, contactChoices);
        JSONArray emails = new JSONArray();
        for (String part : emailField.getText().toString().split("[\\n;,]")) {
            String value = part.trim();
            if (!value.isEmpty()) emails.put(value);
        }
        JSONObject contact = new JSONObject()
            .put("selected", true)
            .put("action", "update".equals(contactChoice.action) ? "update" : "create")
            .put("name", person)
            .put("job_title", text(jobField))
            .put("phone", text(phoneField))
            .put("emails", emails)
            .put("company_name", companyName)
            .put("source", "Carte de visite");
        if (!contactChoice.id.isEmpty()) contact.put("id", contactChoice.id);
        if (!linkedCompanyId.isEmpty()) contact.put("company_id", linkedCompanyId);
        return new JSONObject().put("companies", companyOut).put("contacts", new JSONArray().put(contact));
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

    private static Choice selected(Spinner spinner, List<Choice> choices) {
        if (spinner == null || choices == null || choices.isEmpty()) return new Choice("", "create");
        int idx = spinner.getSelectedItemPosition();
        if (idx < 0 || idx >= choices.size()) return new Choice("", "create");
        return choices.get(idx);
    }

    private Spinner choiceSpinner(LinearLayout body, JSONArray matches, List<Choice> choices, boolean company, boolean preferUpdate) throws Exception {
        TextView label = ui.subtitle(company ? "Entreprise déjà présente" : "Contact déjà présent");
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
                    if (i == 0) select = preferUpdate ? choices.size() - 1 : choices.size() - 2;
                } else {
                    labels.add("Compléter « " + name + " »");
                    choices.add(new Choice(id, "update"));
                    if (i == 0) select = preferUpdate ? choices.size() - 1 : 0;
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
        finally { if (!temp.delete() && temp.exists()) temp.deleteOnExit(); }
    }

    private void addImageFile(File file) throws Exception {
        if (file == null || !file.isFile() || file.length() <= 0) {
            throw new Exception("La photo est vide. L’appareil photo n’a pas enregistré l’image.");
        }
        Bitmap bitmap = decodeOriented(file);
        if (bitmap == null) throw new Exception("Image illisible. Reprenez la photo ou choisissez un autre fichier.");
        try { addBitmap(bitmap, "image/jpeg"); }
        finally { if (!bitmap.isRecycled()) bitmap.recycle(); }
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
        try {
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
        } finally {
            if (scaled != bitmap && !scaled.isRecycled()) scaled.recycle();
        }
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

    private static String firstFilled(JSONObject src, String... keys) {
        for (String key : keys) {
            String value = src.optString(key, "").trim();
            if (!value.isEmpty()) return value;
        }
        return "";
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

    private void dismissProgress() {
        stopProgressLoop();
        progressBar = null;
        shownPercent = 0;
        if (progressDialog == null) return;
        try { progressDialog.dismiss(); } catch (Exception ignored) {}
        progressDialog = null;
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
        if (message.matches("(?i).*(openai|gpt-|intelligence artificielle|prestataire).*")) {
            return "La lecture de la carte a échoué. Réessayez ou saisissez les informations. Aucune fiche n’a été créée.";
        }
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

    private void wipeImage() {
        pages.clear();
        deleteCaptureFiles();
    }

    private void discardPhoto() {
        wipeImage();
    }

    private int dp(int value) { return ui.dp(value); }
}
