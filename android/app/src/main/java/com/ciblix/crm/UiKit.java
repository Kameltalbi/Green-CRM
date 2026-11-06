package com.ciblix.crm;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.Editable;
import android.text.InputType;
import android.text.TextUtils;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Composants Pétrole & Sauge réutilisés par tous les écrans natifs. */
final class UiKit {
    static final int PETROLEUM = Color.rgb(23, 61, 65); // #173D41
    static final int SAGE = Color.rgb(64, 143, 134); // #408F86
    static final int SAGE_WASH = Color.rgb(224, 238, 234); // #E0EEEA
    static final int ACCENT = Color.rgb(104, 173, 165);
    static final int BG = Color.rgb(244, 247, 246); // #F4F7F6
    static final int MIST = Color.rgb(237, 242, 240); // #EDF2F0
    static final int SURFACE = Color.WHITE;
    static final int FIELD = Color.rgb(232, 240, 237); // #E8F0ED
    static final int MUTED = Color.rgb(100, 116, 139); // #64748B
    static final int ORANGE = Color.rgb(242, 165, 65); // #F2A541
    static final int BLUE = Color.rgb(59, 130, 246); // #3B82F6
    static final int TURQUOISE = Color.rgb(20, 184, 166); // #14B8A6
    static final int CORAL = Color.rgb(239, 100, 97); // #EF6461
    static final int DANGER = CORAL;
    static final int WARN = ORANGE;

    static int wash(int color) {
        return Color.argb(42, Color.red(color), Color.green(color), Color.blue(color));
    }

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
        int color = tone == 0 ? TURQUOISE : tone == 1 ? ORANGE : tone == 2 ? CORAL : MUTED;
        TextView t = label(value, 12, color, true);
        t.setBackground(round(wash(color), 999));
        t.setPadding(dp(10), dp(5), dp(10), dp(5));
        return t;
    }

    Button primary(String text, Runnable action) {
        return actionButton(text, PETROLEUM, SURFACE, true, action);
    }

    Button vivid(String text, int color, Runnable action) {
        return actionButton(text, color, SURFACE, true, action);
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

    TextView pageTitle(String value) {
        TextView t = label(value, 28, PETROLEUM, true);
        t.setPadding(0, 0, 0, 0);
        t.setLetterSpacing(-0.03f);
        return t;
    }

    TextView orgBadge(String value) {
        TextView t = label(value == null || value.isEmpty() ? "Espace" : value, 13, PETROLEUM, true);
        t.setBackground(round(SAGE_WASH, 999));
        t.setPadding(dp(12), dp(6), dp(12), dp(6));
        t.setMaxLines(1);
        t.setEllipsize(TextUtils.TruncateAt.END);
        t.setMaxWidth(dp(168));
        return t;
    }

    ImageButton squareAction(int icon, int background, String description, Runnable action) {
        return squareAction(icon, background, PETROLEUM, description, action);
    }

    ImageButton squareAction(int icon, int background, int tint, String description, Runnable action) {
        ImageButton button = new ImageButton(context);
        button.setImageResource(icon);
        button.setColorFilter(tint);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setBackground(round(background, 16));
        button.setBackgroundTintList(null);
        button.setStateListAnimator(null);
        button.setPadding(dp(12), dp(12), dp(12), dp(12));
        button.setContentDescription(description);
        int size = dp(48);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(size, size);
        button.setLayoutParams(lp);
        button.setOnClickListener(v -> action.run());
        return button;
    }

    /** Recherche avec loupe et effacement. Le filtrage est déclenché par le texte, sans bouton OK. */
    FrameLayout directorySearch(String hint, String value, java.util.function.Consumer<String> onChange) {
        FrameLayout wrap = new FrameLayout(context);
        EditText field = new EditText(context);
        field.setHint(hint);
        field.setText(value == null ? "" : value);
        field.setSingleLine(true);
        field.setTextSize(15);
        field.setTextColor(PETROLEUM);
        field.setHintTextColor(MUTED);
        field.setBackground(round(FIELD, 22));
        field.setCompoundDrawablesRelativeWithIntrinsicBounds(R.drawable.ic_search, 0, 0, 0);
        field.setCompoundDrawablePadding(dp(8));
        field.setPadding(dp(14), dp(12), dp(44), dp(12));
        field.setMinHeight(dp(48));
        field.setImeOptions(EditorInfo.IME_ACTION_SEARCH);
        field.setContentDescription(hint);
        ImageButton clear = new ImageButton(context);
        clear.setImageResource(R.drawable.ic_close);
        clear.setBackgroundColor(Color.TRANSPARENT);
        clear.setContentDescription("Effacer la recherche");
        clear.setScaleType(ImageView.ScaleType.CENTER);
        clear.setVisibility(field.getText().length() == 0 ? View.GONE : View.VISIBLE);
        clear.setOnClickListener(v -> field.setText(""));
        field.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override public void afterTextChanged(Editable s) {
                clear.setVisibility(s.length() == 0 ? View.GONE : View.VISIBLE);
                onChange.accept(s.toString());
            }
        });
        wrap.addView(field, new FrameLayout.LayoutParams(-1, -2));
        FrameLayout.LayoutParams clearLp = new FrameLayout.LayoutParams(dp(40), dp(40), Gravity.END | Gravity.CENTER_VERTICAL);
        clearLp.rightMargin = dp(4);
        wrap.addView(clear, clearLp);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(14);
        lp.bottomMargin = dp(6);
        wrap.setLayoutParams(lp);
        return wrap;
    }

    LinearLayout entityCard(int icon, int tint, String title, String detail, boolean pin, Runnable action) {
        LinearLayout card = row();
        card.setBackground(round(SURFACE, 18));
        card.setElevation(dp(2));
        card.setPadding(dp(12), dp(12), dp(10), dp(12));
        card.setMinimumHeight(dp(72));

        FrameLayout box = new FrameLayout(context);
        box.setBackground(round(wash(tint), 14));
        ImageView mark = new ImageView(context);
        mark.setImageResource(icon);
        mark.setColorFilter(tint);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        box.addView(mark, new FrameLayout.LayoutParams(dp(22), dp(22), Gravity.CENTER));
        card.addView(box, new LinearLayout.LayoutParams(dp(44), dp(44)));

        LinearLayout texts = column();
        texts.setPadding(dp(12), 0, dp(8), 0);
        TextView name = label(title, 16, PETROLEUM, true);
        name.setPadding(0, 0, 0, 0);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        texts.addView(name);
        if (detail != null && !detail.trim().isEmpty()) {
            if (pin) {
                LinearLayout loc = row();
                loc.setPadding(0, dp(2), 0, 0);
                ImageView marker = new ImageView(context);
                marker.setImageResource(R.drawable.ic_pin);
                marker.setColorFilter(tint);
                marker.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
                loc.addView(marker, new LinearLayout.LayoutParams(dp(14), dp(14)));
                TextView place = label(detail, 13, MUTED, false);
                place.setPadding(dp(4), 0, 0, 0);
                place.setMaxLines(1);
                place.setEllipsize(TextUtils.TruncateAt.END);
                loc.addView(place);
                texts.addView(loc);
            } else {
                TextView meta = label(detail, 13, MUTED, false);
                meta.setPadding(0, dp(2), 0, 0);
                meta.setMaxLines(1);
                meta.setEllipsize(TextUtils.TruncateAt.END);
                texts.addView(meta);
            }
        }
        texts.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(texts);

        ImageView chevron = new ImageView(context);
        chevron.setImageResource(R.drawable.ic_chevron);
        chevron.setColorFilter(tint);
        chevron.setContentDescription("Ouvrir");
        card.addView(chevron, new LinearLayout.LayoutParams(dp(20), dp(20)));
        card.setOnClickListener(v -> action.run());
        card.setClickable(true);
        card.setFocusable(true);
        return card;
    }

    LinearLayout navTab(int icon, String label, boolean selected, int accent, Runnable action) {
        LinearLayout tab = column();
        tab.setGravity(Gravity.CENTER_HORIZONTAL);
        tab.setBackground(round(selected ? wash(accent) : Color.TRANSPARENT, 16));
        tab.setPadding(dp(2), dp(6), dp(2), dp(4));
        ImageView mark = new ImageView(context);
        mark.setImageResource(icon);
        mark.setColorFilter(selected ? accent : MUTED);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(20), dp(20));
        ip.gravity = Gravity.CENTER_HORIZONTAL;
        tab.addView(mark, ip);
        TextView caption = label(label, 10, selected ? accent : MUTED, selected);
        caption.setGravity(Gravity.CENTER);
        caption.setPadding(0, dp(2), 0, 0);
        caption.setMaxLines(1);
        caption.setEllipsize(TextUtils.TruncateAt.END);
        tab.addView(caption);
        tab.setOnClickListener(v -> action.run());
        tab.setClickable(true);
        tab.setContentDescription(label);
        return tab;
    }

    /** Bandeau OCR : fond pétrole, icône orange, toute la surface ouvre la capture. */
    LinearLayout scanBanner(Runnable action) {
        LinearLayout card = row();
        card.setBackground(round(PETROLEUM, 16));
        card.setPadding(dp(12), dp(12), dp(12), dp(12));
        card.setMinimumHeight(dp(72));
        FrameLayout box = new FrameLayout(context);
        box.setBackground(round(Color.argb(46, 242, 165, 65), 12));
        ImageView icon = new ImageView(context);
        icon.setImageResource(R.drawable.ic_scan_white);
        icon.setColorFilter(ORANGE);
        icon.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        box.addView(icon, new FrameLayout.LayoutParams(dp(26), dp(26), Gravity.CENTER));
        card.addView(box, new LinearLayout.LayoutParams(dp(44), dp(44)));
        LinearLayout texts = column();
        texts.setPadding(dp(12), 0, dp(8), 0);
        TextView heading = label("Scanner une carte de visite", 15, Color.WHITE, true);
        heading.setPadding(0, 0, 0, 0);
        heading.setMaxLines(1);
        heading.setEllipsize(TextUtils.TruncateAt.END);
        TextView detail = label("Créer rapidement un contact et une entreprise", 12, Color.argb(210, 255, 255, 255), false);
        detail.setPadding(0, dp(2), 0, 0);
        detail.setMaxLines(2);
        texts.addView(heading);
        texts.addView(detail);
        texts.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        card.addView(texts);
        ImageView chevron = new ImageView(context);
        chevron.setImageResource(R.drawable.ic_chevron);
        chevron.setColorFilter(Color.WHITE);
        chevron.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        card.addView(chevron, new LinearLayout.LayoutParams(dp(18), dp(18)));
        card.setOnClickListener(v -> action.run());
        card.setClickable(true);
        card.setContentDescription("Scanner une carte de visite");
        return card;
    }

    LinearLayout statCard(int icon, int tint, String value, String caption, Runnable action) {
        LinearLayout card = column();
        card.setBackground(round(SURFACE, 16));
        card.setElevation(dp(1));
        card.setPadding(dp(12), dp(12), dp(10), dp(12));
        card.setMinimumHeight(dp(104));
        FrameLayout box = new FrameLayout(context);
        box.setBackground(round(Color.argb(28, Color.red(tint), Color.green(tint), Color.blue(tint)), 12));
        ImageView mark = new ImageView(context);
        mark.setImageResource(icon);
        mark.setColorFilter(tint);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        box.addView(mark, new FrameLayout.LayoutParams(dp(18), dp(18), Gravity.CENTER));
        card.addView(box, new LinearLayout.LayoutParams(dp(32), dp(32)));
        TextView figure = label(value, 26, PETROLEUM, true);
        figure.setPadding(0, dp(8), 0, 0);
        figure.setMaxLines(1);
        card.addView(figure);
        TextView name = label(caption, 12, MUTED, false);
        name.setPadding(0, dp(1), 0, 0);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        name.setAutoSizeTextTypeUniformWithConfiguration(9, 12, 1, TypedValue.COMPLEX_UNIT_SP);
        card.addView(name);
        card.setOnClickListener(v -> action.run());
        card.setClickable(true);
        card.setContentDescription(caption + ", " + value);
        return card;
    }

    /** Indicateur compact : icône, valeur, libellé, variation réelle optionnelle. */
    LinearLayout kpiTile(int icon, int tint, String value, String caption, String extra, int extraColor, Runnable action) {
        LinearLayout card = column();
        card.setBackground(round(SURFACE, 16));
        card.setElevation(dp(1));
        card.setPadding(dp(10), dp(10), dp(10), dp(10));
        card.setMinimumHeight(dp(92));
        card.setClipToOutline(true);
        card.setOutlineProvider(ViewOutlineProvider.BACKGROUND);
        LinearLayout top = row();
        top.setMinimumHeight(dp(28));
        FrameLayout box = new FrameLayout(context);
        box.setBackground(round(Color.argb(36, Color.red(tint), Color.green(tint), Color.blue(tint)), 10));
        ImageView mark = new ImageView(context);
        mark.setImageResource(icon);
        mark.setColorFilter(tint);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        box.addView(mark, new FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER));
        top.addView(box, new LinearLayout.LayoutParams(dp(28), dp(28)));
        if (extra != null && !extra.isEmpty()) {
            TextView badge = label(extra, 11, extraColor, true);
            badge.setGravity(Gravity.END);
            badge.setMaxLines(1);
            badge.setEllipsize(TextUtils.TruncateAt.END);
            badge.setPadding(dp(4), 0, 0, 0);
            badge.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
            top.addView(badge);
        }
        card.addView(top);
        TextView figure = label(value, 22, PETROLEUM, true);
        figure.setPadding(0, dp(6), 0, 0);
        figure.setMaxLines(1);
        figure.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        figure.setAutoSizeTextTypeUniformWithConfiguration(14, 22, 1, TypedValue.COMPLEX_UNIT_SP);
        card.addView(figure);
        TextView name = label(caption, 12, MUTED, false);
        name.setPadding(0, 0, 0, 0);
        name.setMaxLines(1);
        name.setEllipsize(TextUtils.TruncateAt.END);
        card.addView(name);
        card.setOnClickListener(v -> action.run());
        card.setClickable(true);
        card.setFocusable(true);
        card.setContentDescription(caption + ", " + value + (extra == null || extra.isEmpty() ? "" : ", " + extra));
        return card;
    }

    LinearLayout sectionTitle(String title, String link, Runnable action) {
        return sectionTitle(title, link, SAGE, action);
    }

    LinearLayout sectionTitle(String title, String link, int linkColor, Runnable action) {
        LinearLayout row = row();
        TextView heading = label(title, 16, PETROLEUM, true);
        heading.setPadding(0, 0, 0, 0);
        heading.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(heading);
        if (link != null && action != null) {
            TextView more = label(link, 13, linkColor, true);
            more.setPadding(dp(8), dp(8), 0, dp(8));
            more.setOnClickListener(v -> action.run());
            more.setContentDescription(link + " " + title);
            row.addView(more);
        }
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(18);
        lp.bottomMargin = dp(8);
        row.setLayoutParams(lp);
        return row;
    }

    LinearLayout agendaCard(String late, Runnable openLate, String today, Runnable openToday) {
        LinearLayout card = column();
        card.setBackground(round(SURFACE, 16));
        card.setElevation(dp(1));
        card.setPadding(dp(4), dp(4), dp(4), dp(4));
        card.addView(agendaLine(R.drawable.ic_clock, CORAL, "En retard", late, openLate));
        View rule = new View(context);
        rule.setBackgroundColor(Color.rgb(236, 241, 239));
        LinearLayout.LayoutParams ruleLp = new LinearLayout.LayoutParams(-1, dp(1));
        ruleLp.leftMargin = dp(48);
        card.addView(rule, ruleLp);
        card.addView(agendaLine(R.drawable.ic_calendar, TURQUOISE, "Aujourd’hui", today, openToday));
        return card;
    }

    private LinearLayout agendaLine(int icon, int tint, String title, String count, Runnable action) {
        LinearLayout row = row();
        row.setPadding(dp(8), dp(10), dp(8), dp(10));
        row.setMinimumHeight(dp(52));
        ImageView mark = new ImageView(context);
        mark.setImageResource(icon);
        mark.setColorFilter(tint);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        row.addView(mark, new LinearLayout.LayoutParams(dp(22), dp(22)));
        TextView name = label(title, 15, PETROLEUM, true);
        name.setPadding(dp(10), 0, 0, 0);
        name.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(name);
        TextView badge = label(count, 13, Color.WHITE, true);
        badge.setBackground(round(tint, 999));
        badge.setPadding(dp(10), dp(4), dp(10), dp(4));
        badge.setMinWidth(dp(28));
        badge.setGravity(Gravity.CENTER);
        row.addView(badge);
        ImageView chevron = new ImageView(context);
        chevron.setImageResource(R.drawable.ic_chevron);
        chevron.setColorFilter(MUTED);
        LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(dp(16), dp(16));
        cp.leftMargin = dp(8);
        row.addView(chevron, cp);
        row.setOnClickListener(v -> action.run());
        row.setClickable(true);
        row.setContentDescription(title + ", " + count);
        return row;
    }

    LinearLayout activityLine(int icon, int tint, String text, String when) {
        LinearLayout row = row();
        row.setPadding(0, dp(8), 0, dp(8));
        row.setMinimumHeight(dp(48));
        FrameLayout box = new FrameLayout(context);
        box.setBackground(round(Color.argb(28, Color.red(tint), Color.green(tint), Color.blue(tint)), 10));
        ImageView mark = new ImageView(context);
        mark.setImageResource(icon);
        mark.setColorFilter(tint);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        box.addView(mark, new FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER));
        row.addView(box, new LinearLayout.LayoutParams(dp(32), dp(32)));
        LinearLayout texts = column();
        texts.setPadding(dp(10), 0, 0, 0);
        TextView body = label(text, 14, PETROLEUM, false);
        body.setPadding(0, 0, 0, 0);
        body.setMaxLines(2);
        body.setEllipsize(TextUtils.TruncateAt.END);
        texts.addView(body);
        if (when != null && !when.isEmpty()) {
            TextView time = label(when, 12, MUTED, false);
            time.setPadding(0, dp(1), 0, 0);
            texts.addView(time);
        }
        texts.setLayoutParams(new LinearLayout.LayoutParams(0, -2, 1));
        row.addView(texts);
        return row;
    }

    LinearLayout quietEmpty(String message) {
        LinearLayout card = column();
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setBackground(round(Color.rgb(236, 244, 241), 16));
        card.setPadding(dp(16), dp(18), dp(16), dp(18));
        ImageView mark = new ImageView(context);
        mark.setImageResource(R.drawable.ic_tray);
        mark.setColorFilter(SAGE);
        mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(28), dp(28));
        ip.gravity = Gravity.CENTER_HORIZONTAL;
        card.addView(mark, ip);
        TextView text = label(message, 14, MUTED, false);
        text.setGravity(Gravity.CENTER);
        text.setPadding(0, dp(6), 0, 0);
        card.addView(text);
        return card;
    }

    Button chip(String text, boolean filled, Runnable action) {
        Button b = new Button(context);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTypeface(null, Typeface.BOLD);
        b.setTextColor(filled ? SURFACE : SAGE);
        b.setBackground(round(filled ? ORANGE : wash(SAGE), 14));
        b.setBackgroundTintList(null);
        b.setStateListAnimator(null);
        b.setPadding(dp(16), dp(8), dp(16), dp(8));
        b.setMinHeight(dp(40));
        b.setOnClickListener(v -> action.run());
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-2, -2);
        p.rightMargin = dp(8);
        b.setLayoutParams(p);
        return b;
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
