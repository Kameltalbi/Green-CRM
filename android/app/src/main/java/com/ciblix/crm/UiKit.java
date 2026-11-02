package com.ciblix.crm;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Composants Pétrole & Sauge réutilisés par tous les écrans natifs. */
final class UiKit {
    static final int PETROLEUM = Color.rgb(23, 61, 65);
    static final int SAGE = Color.rgb(64, 143, 134);
    static final int ACCENT = Color.rgb(104, 173, 165);
    static final int BG = Color.rgb(244, 247, 246);
    static final int SURFACE = Color.WHITE;
    static final int FIELD = Color.rgb(237, 242, 240);
    static final int MUTED = Color.rgb(100, 116, 139);
    static final int DANGER = Color.rgb(185, 78, 72);
    static final int WARN = Color.rgb(180, 120, 48);

    private final Context context;
    private final float density;

    UiKit(Context context) {
        this.context = context;
        this.density = context.getResources().getDisplayMetrics().density;
    }

    int dp(int value) { return (int) (density * value); }

    GradientDrawable round(int color, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    /** Surface blanche sans bordure, ombre très légère via élévation douce. */
    LinearLayout surfaceCard() {
        LinearLayout c = column();
        c.setBackground(round(SURFACE, 16));
        c.setPadding(dp(16), dp(16), dp(16), dp(16));
        c.setElevation(dp(2));
        return c;
    }

    LinearLayout column() {
        LinearLayout l = new LinearLayout(context);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    LinearLayout row() {
        LinearLayout l = new LinearLayout(context);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    TextView title(String value) {
        TextView t = label(value, 22, PETROLEUM, true);
        t.setPadding(0, dp(2), 0, dp(2));
        t.setLetterSpacing(-0.02f);
        return t;
    }

    TextView subtitle(String value) {
        return label(value, 14, MUTED, false);
    }

    TextView label(String value, int size, int color, boolean bold) {
        TextView t = new TextView(context);
        t.setText(value);
        t.setTextSize(size);
        t.setTextColor(color);
        if (bold) t.setTypeface(null, Typeface.BOLD);
        t.setPadding(0, dp(2), 0, dp(2));
        return t;
    }

    TextView caption(String value) {
        TextView t = label(value, 12, MUTED, true);
        t.setLetterSpacing(0.04f);
        t.setAllCaps(true);
        t.setPadding(0, 0, 0, dp(4));
        return t;
    }

    TextView emptyState(String value) {
        TextView t = label(value, 15, MUTED, false);
        t.setGravity(Gravity.CENTER);
        t.setPadding(dp(12), dp(28), dp(12), dp(28));
        return t;
    }

    TextView statusPill(String value, int tone) {
        TextView t = label(value, 12, tone == 0 ? SAGE : tone == 1 ? WARN : tone == 2 ? DANGER : MUTED, true);
        GradientDrawable bg = round(tone == 0 ? Color.rgb(228, 235, 232) : tone == 1 ? Color.rgb(247, 238, 220) : tone == 2 ? Color.rgb(247, 230, 228) : FIELD, 999);
        t.setBackground(bg);
        t.setPadding(dp(10), dp(5), dp(10), dp(5));
        return t;
    }

    Button primary(String text, Runnable action) {
        return actionButton(text, PETROLEUM, SURFACE, true, action);
    }

    Button secondary(String text, Runnable action) {
        return actionButton(text, FIELD, PETROLEUM, false, action);
    }

    Button ghost(String text, Runnable action) {
        Button b = actionButton(text, Color.TRANSPARENT, SAGE, false, action);
        b.setPadding(dp(8), dp(8), dp(8), dp(8));
        LinearLayout.LayoutParams p = (LinearLayout.LayoutParams) b.getLayoutParams();
        if (p != null) { p.topMargin = dp(0); p.bottomMargin = dp(0); }
        return b;
    }

    private Button actionButton(String text, int bg, int fg, boolean bold, Runnable action) {
        Button b = new Button(context);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(15);
        b.setTypeface(null, bold ? Typeface.BOLD : Typeface.NORMAL);
        b.setTextColor(fg);
        b.setBackground(round(bg, 12));
        b.setPadding(dp(16), dp(13), dp(16), dp(13));
        b.setStateListAnimator(null);
        b.setElevation(0);
        b.setMinHeight(dp(48));
        b.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.topMargin = dp(8);
        p.bottomMargin = dp(4);
        b.setLayoutParams(p);
        return b;
    }

    Button navItem(String label, boolean selected, Runnable action) {
        Button b = new Button(context);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setTypeface(null, selected ? Typeface.BOLD : Typeface.NORMAL);
        b.setTextColor(selected ? SURFACE : MUTED);
        b.setBackground(round(selected ? SAGE : SURFACE, 12));
        b.setPadding(dp(6), dp(12), dp(6), dp(12));
        b.setStateListAnimator(null);
        b.setElevation(0);
        b.setMinHeight(dp(44));
        b.setOnClickListener(v -> action.run());
        return b;
    }

    EditText field(LinearLayout parent, String label, String value, int type) {
        TextView caption = label(label, 13, MUTED, false);
        caption.setPadding(0, dp(10), 0, dp(4));
        parent.addView(caption);
        EditText e = new EditText(context);
        e.setTextSize(16);
        e.setInputType(type);
        e.setText(value);
        e.setSingleLine(true);
        e.setContentDescription(label);
        e.setTextColor(PETROLEUM);
        e.setHintTextColor(MUTED);
        e.setBackground(round(FIELD, 12));
        e.setPadding(dp(14), dp(13), dp(14), dp(13));
        e.setMinHeight(dp(48));
        parent.addView(e);
        return e;
    }

    EditText searchField(String value) {
        EditText e = new EditText(context);
        e.setTextSize(16);
        e.setInputType(InputType.TYPE_CLASS_TEXT);
        e.setText(value);
        e.setHint("Rechercher…");
        e.setSingleLine(true);
        e.setContentDescription("Rechercher");
        e.setTextColor(PETROLEUM);
        e.setHintTextColor(MUTED);
        e.setBackground(round(FIELD, 12));
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        e.setMinHeight(dp(48));
        return e;
    }

    ImageView brandLogo(int maxHeightDp) {
        ImageView logo = new ImageView(context);
        logo.setImageResource(R.drawable.logo_ciblix);
        logo.setAdjustViewBounds(true);
        logo.setMaxHeight(dp(maxHeightDp));
        logo.setScaleType(ImageView.ScaleType.FIT_START);
        logo.setContentDescription("Ciblix");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, dp(maxHeightDp));
        logo.setLayoutParams(lp);
        return logo;
    }

    /**
     * Bloc OCR principal : icône scan, titre, sous-texte, CTA pétrole.
     * Destiné au dashboard (avant les métriques) et aux listes Contacts/Entreprises.
     */
    LinearLayout scanHero(String title, String subtitle, String cta, Runnable action) {
        LinearLayout card = surfaceCard();
        card.setBackground(round(Color.rgb(228, 239, 236), 16));
        card.setElevation(dp(1));
        card.setPadding(dp(16), dp(16), dp(16), dp(16));

        LinearLayout head = row();
        ImageView icon = new ImageView(context);
        icon.setImageResource(R.drawable.ic_scan);
        icon.setContentDescription("Scanner");
        icon.setLayoutParams(new LinearLayout.LayoutParams(dp(36), dp(36)));
        head.addView(icon);

        LinearLayout texts = column();
        texts.setPadding(dp(12), 0, 0, 0);
        TextView t = label(title, 17, PETROLEUM, true);
        t.setPadding(0, 0, 0, dp(2));
        texts.addView(t);
        TextView s = label(subtitle, 13, MUTED, false);
        texts.addView(s);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0, -2, 1);
        texts.setLayoutParams(tlp);
        head.addView(texts);
        card.addView(head);

        Button go = primary(cta, action);
        LinearLayout.LayoutParams glp = (LinearLayout.LayoutParams) go.getLayoutParams();
        glp.topMargin = dp(12);
        glp.bottomMargin = 0;
        card.addView(go);
        return card;
    }

    /** Carte métrique compacte : libellé + chiffre. */
    LinearLayout metricCard(String label, String value) {
        LinearLayout card = surfaceCard();
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.addView(caption(label));
        TextView figure = label(value, 28, PETROLEUM, true);
        figure.setPadding(0, dp(2), 0, 0);
        figure.setLetterSpacing(-0.03f);
        card.addView(figure);
        return card;
    }

    /** Ligne de liste contact/entreprise : titre, détail, action discrète. */
    LinearLayout listRow(String title, String detail, String actionLabel, Runnable action) {
        LinearLayout card = surfaceCard();
        TextView name = label(title, 17, PETROLEUM, true);
        name.setPadding(0, 0, 0, dp(2));
        card.addView(name);
        if (detail != null && !detail.trim().isEmpty()) {
            TextView meta = label(detail, 14, MUTED, false);
            meta.setPadding(0, 0, 0, dp(8));
            card.addView(meta);
        }
        if (actionLabel != null && action != null) {
            Button open = ghost(actionLabel, action);
            LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
            open.setLayoutParams(p);
            card.addView(open);
        }
        return card;
    }

    LinearLayout sectionHeader(String title, String count) {
        LinearLayout row = row();
        TextView h = label(title, 16, PETROLEUM, true);
        h.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(h);
        if (count != null) row.addView(statusPill(count, 3));
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.topMargin = dp(16);
        p.bottomMargin = dp(6);
        row.setLayoutParams(p);
        return row;
    }

    void margin(View view, int top, int bottom) {
        LinearLayout.LayoutParams p = view.getLayoutParams() instanceof LinearLayout.LayoutParams
            ? (LinearLayout.LayoutParams) view.getLayoutParams()
            : new LinearLayout.LayoutParams(-1, -2);
        p.width = -1;
        p.topMargin = dp(top);
        p.bottomMargin = dp(bottom);
        view.setLayoutParams(p);
    }
}
