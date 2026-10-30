package com.ciblix.crm;

import android.app.*;
import android.os.Bundle;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.net.URLEncoder;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public final class MainActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ApiClient api;
    private SessionStore sessions;
    private LinearLayout root, content, navigation;
    private WebView web;
    private TextView status;
    private String section = "dashboard", query = "", organization = "Mon espace";
    private int offset = 0, generation = 0;
    private boolean busy = false;
    private static final int BLUE = Color.rgb(1,59,229), INK = Color.rgb(31,41,55);
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        sessions = new SessionStore(this);
        api = new ApiClient(getPreferences(0).getString("server", "https://ciblix.com"));
        api.token = sessions.read();
        if (state != null) { section = state.getString("section", "dashboard"); query = state.getString("query", ""); offset = state.getInt("offset"); }
        if (api.token.isEmpty()) openSite(state); else loadIdentity();
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        super.onBackPressed();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state); state.putString("section", section); state.putString("query", query); state.putInt("offset", offset);
        if (web != null) web.saveState(state);
    }
    @Override protected void onDestroy() {
        generation++;
        if (web != null) { web.destroy(); web = null; }
        worker.shutdownNow();
        super.onDestroy();
    }
    private int dp(int value) { return (int) (getResources().getDisplayMetrics().density * value); }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private TextView text(String value, int size) {
        TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(INK); t.setPadding(0,dp(8),0,dp(8)); return t;
    }
    private Button button(String label, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setTextSize(16); b.setOnClickListener(v -> action.run()); return b;
    }
    private EditText field(LinearLayout parent, String label, String value, int type) {
        parent.addView(text(label,14)); EditText e = new EditText(this); e.setTextSize(16); e.setInputType(type); e.setText(value); e.setSingleLine(true); e.setContentDescription(label); parent.addView(e); return e;
    }
    private void frame(String title) {
        generation++; busy = false;
        root = column(); root.setPadding(dp(20),0,dp(20),0); root.setBackgroundColor(Color.rgb(245,247,252));
        root.setOnApplyWindowInsetsListener((v,insets)->{ root.setPadding(dp(20),insets.getSystemWindowInsetTop(),dp(20),insets.getSystemWindowInsetBottom()); return insets; });
        TextView brand = text("ciblix",28); brand.setTextColor(BLUE); brand.setTypeface(null,Typeface.BOLD); root.addView(brand);
        TextView heading = text(title,24); heading.setTypeface(null,Typeface.BOLD); root.addView(heading);
        status = text("",14); status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); root.addView(status);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true); content = column(); scroll.addView(content);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1)); navigation = column(); root.addView(navigation); setContentView(root); root.requestApplyInsets();
    }
    interface Task { JSONObject run() throws Exception; }
    interface Done { void run(JSONObject data) throws Exception; }
    private void run(Task task, Done done) {
        if (busy) return;
        busy = true; status.setText("Chargement…"); final int current = generation;
        worker.execute(()->{
            JSONObject result = null; Exception failure = null;
            try { result = task.run(); } catch (Exception e) { failure = e; }
            final JSONObject data = result; final Exception error = failure;
            runOnUiThread(()->{
                if (isDestroyed() || current != generation) return;
                busy = false; status.setText("");
                try {
                    if (error != null) throw error;
                    done.run(data);
                } catch (Exception e) {
                    if (e instanceof ApiClient.Failure && ((ApiClient.Failure)e).status == 401 && !api.token.isEmpty()) {
                        sessions.clear(); api.token = ""; openSite(null);
                    } else status.setText(e instanceof java.io.IOException ? "Serveur inaccessible. Vérifiez l’adresse et la connexion, puis réessayez." : e.getMessage());
                }
            });
        });
    }
    private void openSite(Bundle state) {
        generation++; busy = false;
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
        web.setBackgroundColor(Color.rgb(245,247,252));
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
                view.loadDataWithBaseURL(entry, "<html><body style=\"font-family:sans-serif;padding:32px;background:#F5F7FC;color:#1F2937\"><h1>Ciblix</h1><p>La page de connexion est inaccessible. Vérifiez la connexion, puis réessayez.</p><p><a href=\"" + entry + "\">Réessayer</a></p></body></html>", "text/html", "utf-8", null);
            }
        });
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(web);
        web.requestApplyInsets();
        if (state == null || web.restoreState(state) == null) web.loadUrl(api.base + "/connexion");
    }
    private void loadIdentity() {
        frame("Ouverture de votre espace");
        content.addView(button("Réessayer",this::loadIdentity));
        content.addView(button("Changer de serveur / compte",()->{sessions.clear();api.token="";openSite(null);}));
        run(()->api.request("GET","/api/v1/account",null),account->{
            JSONArray orgs = account.getJSONArray("organizations");
            if (orgs.length()==0) { onboarding(); return; }
            loadWorkspace();
        });
    }
    private void loadWorkspace() {
        run(()->api.request("GET","/api/v1/me",null),me->{ organization = me.getJSONObject("organization").getString("name"); show(); });
    }
    private void onboarding() {
        frame("Créer votre espace"); EditText name = field(content,"Nom de l’entreprise","",InputType.TYPE_CLASS_TEXT);
        content.addView(button("Créer mon espace",()->{
            try { JSONObject body = new JSONObject().put("companyName",name.getText().toString().trim());
                run(()->api.request("POST","/api/v1/onboarding",body),d->loadWorkspace());
            } catch (Exception e) { status.setText(e.getMessage()); }
        }));
    }
    private String title() { return switch(section) { case "contacts" -> "Contacts"; case "companies" -> "Entreprises"; case "followups" -> "Relances"; default -> "Tableau de bord"; }; }
    private void show() {
        frame(title()); content.addView(text(organization,16));
        String[] routes={"dashboard","contacts","companies","followups"}; String[] labels={"Accueil","Contacts","Entreprises","Relances"};
        // Two rows keep navigation readable with large system fonts.
        for(int row=0;row<2;row++) { LinearLayout line=new LinearLayout(this);
            for(int i=row*2;i<row*2+2;i++){ final String route=routes[i]; Button b=button(labels[i],()->{if(busy)return;section=route;offset=0;query="";show();}); b.setTextColor(section.equals(route)?BLUE:INK); line.addView(b,new LinearLayout.LayoutParams(0,-2,1)); } navigation.addView(line); }
        content.addView(button("Actualiser",()->{if(!busy)show();}));
        if(section.equals("dashboard")) {
            content.addView(button("Mon compte",this::accountMenu));
            run(()->api.request("GET","/api/v1/dashboard",null),data->{
                JSONObject counts=data.getJSONObject("counts"); card("Contacts",counts.optString("contacts","0")); card("Entreprises",counts.optString("companies","0")); card("Relances ouvertes",counts.optString("pending","0"));
                JSONObject periods=data.getJSONObject("periods");
                String[] keys={"late","today","upcoming"}, names={"En retard","Aujourd’hui","À venir"};
                for(int i=0;i<keys.length;i++) { JSONObject page=periods.getJSONObject(keys[i]); content.addView(text(names[i]+" · "+page.optInt("total"),20)); JSONArray items=page.getJSONArray("items");
                    for(int j=0;j<items.length();j++) followupCard(items.getJSONObject(j));
                }
            });
        } else {
            if(!section.equals("followups")) {
                EditText search=field(content,"Rechercher",query,InputType.TYPE_CLASS_TEXT);
                content.addView(button("Rechercher",()->{if(busy)return;query=search.getText().toString().trim();offset=0;show();}));
            }
            content.addView(button("+ "+(section.equals("followups")?"Planifier une relance":"Créer une fiche"),()->{if(!busy)edit(new JSONObject());}));
            final String route=section;
            run(()->api.request("GET","/api/v1/"+route+"?limit=25&offset="+offset+"&q="+URLEncoder.encode(query,"UTF-8"),null),data->{
                JSONArray items=data.getJSONArray("items"); int total=data.getInt("total");
                content.addView(text(total==0?"Aucun résultat":(offset+1)+"–"+(offset+items.length())+" sur "+total,14));
                for(int i=0;i<items.length();i++) { JSONObject item=items.getJSONObject(i);
                    if(route.equals("followups"))followupCard(item);else{LinearLayout c=card(item.optString("name"),route.equals("contacts")?clean(item,"job_title")+"\n"+clean(item,"phone"):clean(item,"sector")+" · "+clean(item,"city"));c.addView(button("Ouvrir la fiche",()->detail(item)));}
                }
                if(offset>0)content.addView(button("Page précédente",()->{if(busy)return;offset=Math.max(0,offset-25);show();}));
                if(offset+items.length()<total)content.addView(button("Page suivante",()->{if(busy)return;offset+=25;show();}));
            });
        }
    }
    private String clean(JSONObject o,String key){return o.isNull(key)?"":o.optString(key,"");}
    private LinearLayout card(String title,String detail) {
        LinearLayout c=column();c.setPadding(dp(16),dp(8),dp(16),dp(12));GradientDrawable bg=new GradientDrawable();bg.setColor(Color.WHITE);bg.setCornerRadius(dp(14));bg.setStroke(dp(1),Color.rgb(213,220,235));c.setBackground(bg);
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(8),0,dp(8));content.addView(c,p);TextView name=text(title,20);name.setTypeface(null,Typeface.BOLD);c.addView(name);if(!detail.trim().isEmpty())c.addView(text(detail,16));return c;
    }
    private void followupCard(JSONObject item) {
        String state=switch(item.optString("status")){case "completed"->"Terminée";case "cancelled"->"Annulée";default->"À faire";};
        LinearLayout c=card(item.optString("subject"),clean(item,"due_at")+"\n"+state);
        c.addView(button("Modifier",()->{if(!busy)editFollowup(item);}));
        if(item.optString("status").equals("pending"))c.addView(button("Marquer terminée",()->{
            if(busy)return;
            try{JSONObject body=new JSONObject().put("status","completed");run(()->api.request("PATCH","/api/v1/followups/"+item.getString("id"),body),d->show());}catch(Exception e){status.setText(e.getMessage());}
        }));
    }
    private void detail(JSONObject item) {
        if(busy)return;
        String route=section;
        run(()->api.request("GET","/api/v1/"+route+"/"+item.getString("id"),null),record->{
            LinearLayout body=column();body.setPadding(dp(20),0,dp(20),0);
            String[] keys=route.equals("contacts")?new String[]{"name","job_title","phone","source"}:new String[]{"name","sector","city","description"};
            for(String key:keys)if(!clean(record,key).trim().isEmpty())body.addView(text(clean(record,key),16));
            body.addView(button("Modifier",()->edit(record)));
            body.addView(button("Ajouter une note",()->note(route,record)));
            body.addView(button("Planifier une relance",()->{try{JSONObject draft=new JSONObject().put(route.equals("contacts")?"contact_id":"company_id",record.getString("id"));editFollowup(draft);}catch(Exception e){status.setText(e.getMessage());}}));
            ScrollView scroll=new ScrollView(this);scroll.addView(body);new AlertDialog.Builder(this).setTitle(record.optString("name")).setView(scroll).setPositiveButton("Fermer",null).show();
        });
    }
    private void note(String route,JSONObject record) {
        EditText input=new EditText(this);input.setMinLines(3);input.setHint("Note partagée");input.setTextSize(16);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Ajouter une note").setView(input).setNegativeButton("Annuler",null).setPositiveButton("Enregistrer",null).create();
        dialog.setOnShowListener(v->dialog.getButton(-1).setOnClickListener(b->{
            if(input.getText().toString().trim().isEmpty()){input.setError("Saisissez une note.");return;}
            try{JSONObject body=new JSONObject().put("body",input.getText().toString()).put(route.equals("contacts")?"contact_id":"company_id",record.getString("id"));run(()->api.request("POST","/api/v1/notes",body),d->{dialog.dismiss();status.setText("Note enregistrée.");});}catch(Exception e){status.setText(e.getMessage());}
        }));dialog.show();
    }
    private void edit(JSONObject record) { if(section.equals("followups"))editFollowup(record);else editRecord(record); }
    private void editRecord(JSONObject record) {
        String route=section; boolean contact=route.equals("contacts");
        String[] keys=contact?new String[]{"name","job_title","phone","source"}:new String[]{"name","sector","city","description"};
        String[] labels=contact?new String[]{"Nom *","Fonction","Téléphone","Origine"}:new String[]{"Nom *","Secteur","Ville","Description"};
        form(record,route,keys,labels);
    }
    private void editFollowup(JSONObject record) {form(record,"followups",new String[]{"subject","due_at"},new String[]{"Objet *","Échéance avec fuseau (ex. 2026-11-01T09:00:00+01:00) *"});}
    private void form(JSONObject record,String route,String[] keys,String[] labels) {
        LinearLayout body=column();body.setPadding(dp(20),0,dp(20),0);EditText[] fields=new EditText[keys.length];
        for(int i=0;i<keys.length;i++)fields[i]=field(body,labels[i],clean(record,keys[i]),InputType.TYPE_CLASS_TEXT);
        TextView error=text("",14);error.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);body.addView(error);
        ScrollView scroll=new ScrollView(this);scroll.addView(body);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle(record.has("id")?"Modifier":"Créer").setView(scroll).setNegativeButton("Annuler",null).setPositiveButton("Enregistrer",null).create();
        dialog.setOnShowListener(v->dialog.getButton(-1).setOnClickListener(b->{
            if(busy)return;
            if(fields[0].getText().toString().trim().isEmpty()){fields[0].setError("Champ requis");return;}
            try {
                JSONObject payload=new JSONObject();for(int i=0;i<keys.length;i++)payload.put(keys[i],fields[i].getText().toString().trim());
                if(route.equals("followups")) {
                    try {java.time.OffsetDateTime.parse(payload.getString("due_at"));}catch(Exception e){fields[1].setError("Date ISO avec fuseau requise");return;}
                    for(String key:new String[]{"contact_id","company_id"})if(record.has(key)&&!record.has("id"))payload.put(key,record.get(key));
                }
                String path="/api/v1/"+route+(record.has("id")?"/"+record.getString("id"):"");
                // Keep the form and input on HTTP/network errors, allowing correction and retry.
                dialog.getButton(-1).setEnabled(false); final int current=generation;busy=true;error.setText("Enregistrement…");
                worker.execute(()->{
                    Exception failure=null;try{api.request(record.has("id")?"PATCH":"POST",path,payload);}catch(Exception e){failure=e;}
                    final Exception problem=failure;runOnUiThread(()->{
                        if(isDestroyed()||current!=generation)return;busy=false;dialog.getButton(-1).setEnabled(true);
                        if(problem==null){dialog.dismiss();show();}else if(problem instanceof ApiClient.Failure&&((ApiClient.Failure)problem).status==401){dialog.dismiss();sessions.clear();api.token="";openSite(null);}else error.setText(problem.getMessage());
                    });
                });
            }catch(Exception e){error.setText(e.getMessage());}
        }));dialog.show();
    }
    private void accountMenu() {
        if(busy)return;
        run(()->api.request("GET","/api/v1/me",null),me->{
            JSONArray orgs=me.getJSONArray("organizations");LinearLayout body=column();body.setPadding(dp(20),0,dp(20),0);body.addView(text(me.getJSONObject("user").getString("email"),16));
            for(int i=0;i<orgs.length();i++){JSONObject org=orgs.getJSONObject(i);body.addView(button(org.getString("name"),()->{try{JSONObject payload=new JSONObject().put("organization_id",org.getString("id"));run(()->api.request("POST","/api/v1/organizations/switch",payload),d->{section="dashboard";offset=0;query="";loadIdentity();});}catch(Exception e){status.setText(e.getMessage());}}));}
            body.addView(button("Se déconnecter",()->run(()->api.request("POST","/api/v1/auth/logout",new JSONObject()),d->{sessions.clear();api.token="";openSite(null);})));
            ScrollView scroll=new ScrollView(this);scroll.addView(body);new AlertDialog.Builder(this).setTitle("Mon compte").setView(scroll).setPositiveButton("Fermer",null).show();
        });
    }
}
