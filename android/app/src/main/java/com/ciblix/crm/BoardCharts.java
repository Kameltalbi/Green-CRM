package com.ciblix.crm;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.util.TypedValue;
import android.view.MotionEvent;
import android.view.View;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.function.IntConsumer;

/** Graphiques du tableau de bord, dessinés sans bibliothèque tierce. */
final class BoardCharts {
    private static final String[] SHORT_MONTHS = {
        "", "janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"
    };

    private BoardCharts() {}

    static final class Window {
        final String[] buckets;
        final int[] contacts;
        final int[] companies;
        final int contactSum;
        final int companySum;
        final String contactDelta;
        final String companyDelta;

        Window(String[] buckets, int[] contacts, int[] companies, int contactSum, int companySum, String contactDelta, String companyDelta) {
            this.buckets = buckets;
            this.contacts = contacts;
            this.companies = companies;
            this.contactSum = contactSum;
            this.companySum = companySum;
            this.contactDelta = contactDelta;
            this.companyDelta = companyDelta;
        }
    }

    static Window slice(JSONArray rows, int count) throws Exception {
        int end = rows == null ? 0 : rows.length();
        int start = Math.max(0, end - count);
        int n = end - start;
        String[] buckets = new String[n];
        int[] contacts = new int[n];
        int[] companies = new int[n];
        int contactSum = 0;
        int companySum = 0;
        for (int i = 0; i < n; i++) {
            JSONObject row = rows.getJSONObject(start + i);
            buckets[i] = row.optString("bucket");
            contacts[i] = row.optInt("contacts");
            companies[i] = row.optInt("companies");
            contactSum += contacts[i];
            companySum += companies[i];
        }
        String contactDelta = null;
        String companyDelta = null;
        int previousStart = start - n;
        if (n > 0 && previousStart >= 0) {
            int previousContacts = 0;
            int previousCompanies = 0;
            for (int i = previousStart; i < start; i++) {
                JSONObject row = rows.getJSONObject(i);
                previousContacts += row.optInt("contacts");
                previousCompanies += row.optInt("companies");
            }
            contactDelta = delta(contactSum, previousContacts);
            companyDelta = delta(companySum, previousCompanies);
        }
        return new Window(buckets, contacts, companies, contactSum, companySum, contactDelta, companyDelta);
    }

    static String delta(int current, int previous) {
        if (previous <= 0) return current > 0 ? "Nouveau" : null;
        int pct = Math.round((current - previous) * 100f / previous);
        if (pct > 0) return "↗ +" + pct + " %";
        if (pct < 0) return "↘ " + pct + " %";
        return "0 %";
    }

    static String shortLabel(String bucket) {
        if (bucket == null || bucket.length() < 7) return "";
        try {
            int month = Integer.parseInt(bucket.substring(5, 7));
            String name = month >= 1 && month <= 12 ? SHORT_MONTHS[month] : "";
            if (name.isEmpty()) return bucket;
            if (bucket.length() >= 10) return Integer.parseInt(bucket.substring(8, 10)) + " " + name;
            return Character.toUpperCase(name.charAt(0)) + name.substring(1);
        } catch (Exception e) {
            return bucket;
        }
    }

    static int niceMax(int raw) {
        if (raw <= 4) return 4;
        if (raw < 40) return ((raw / 4) + 1) * 4;
        int magnitude = 1;
        while (magnitude * 10L <= raw) magnitude *= 10;
        for (int factor : new int[]{4, 8, 10, 20, 40}) {
            int max = factor * magnitude / (factor >= 40 ? 10 : 1);
            if (max > raw && max % 4 == 0) return max;
        }
        return ((raw / 4) + 1) * 4;
    }

    static final class LineChart extends View {
        private final float density;
        private final Paint grid, axis, guide, tipBg, tipText, contactLine, companyLine, contactFill, companyFill, dot;
        private String[] buckets = new String[0];
        private int[] contacts = new int[0];
        private int[] companies = new int[0];
        private int highlight = -1;
        private float downX, downY;
        private boolean sliding;

        LineChart(Context context) {
            super(context);
            density = context.getResources().getDisplayMetrics().density;
            setClickable(true);
            setFocusable(true);
            grid = stroke(Color.rgb(226, 232, 230), 1f);
            axis = text(UiKit.MUTED, 10);
            axis.setTextAlign(Paint.Align.RIGHT);
            guide = stroke(UiKit.SAGE, 1f);
            tipBg = fill(UiKit.PETROLEUM);
            tipText = text(Color.WHITE, 11);
            tipText.setTextAlign(Paint.Align.LEFT);
            contactLine = stroke(UiKit.SAGE, 2.4f);
            companyLine = stroke(UiKit.ORANGE, 2.4f);
            contactFill = fill(Color.argb(48, 64, 143, 134));
            companyFill = fill(Color.argb(42, 242, 165, 65));
            dot = fill(Color.WHITE);
        }

        void setSeries(String[] buckets, int[] contacts, int[] companies) {
            this.buckets = buckets == null ? new String[0] : buckets;
            this.contacts = contacts == null ? new int[0] : contacts;
            this.companies = companies == null ? new int[0] : companies;
            highlight = -1;
            setContentDescription(summary());
            invalidate();
        }

        @Override protected void onDraw(Canvas canvas) {
            int n = Math.min(buckets.length, Math.min(contacts.length, companies.length));
            if (n == 0 || getWidth() == 0) return;
            float left = dp(28);
            float right = getWidth() - dp(6);
            float top = dp(16);
            float bottom = getHeight() - dp(22);
            if (right <= left || bottom <= top) return;
            int max = 0;
            for (int i = 0; i < n; i++) max = Math.max(max, Math.max(contacts[i], companies[i]));
            max = niceMax(max);
            axis.setTextAlign(Paint.Align.RIGHT);
            for (int tick = 0; tick <= 4; tick++) {
                float y = top + (bottom - top) * (4 - tick) / 4f;
                canvas.drawLine(left, y, right, y, grid);
                canvas.drawText(String.valueOf(max * tick / 4), left - dp(4), y + dp(3), axis);
            }
            drawSeries(canvas, n, companies, max, left, right, top, bottom, companyFill, companyLine);
            drawSeries(canvas, n, contacts, max, left, right, top, bottom, contactFill, contactLine);
            axis.setTextAlign(Paint.Align.LEFT);
            float lastLabel = -10000;
            for (int i = 0; i < n; i++) {
                float x = xAt(i, n, left, right);
                if (!showLabel(i, n, x, lastLabel, left, right)) continue;
                String label = shortLabel(buckets[i]);
                float width = axis.measureText(label);
                float textX = Math.max(left, Math.min(x - width / 2f, right - width));
                canvas.drawText(label, textX, getHeight() - dp(4), axis);
                lastLabel = textX + width;
            }
            if (highlight >= 0 && highlight < n) drawTip(canvas, n, left, right, top, bottom, max);
        }

        private void drawSeries(Canvas canvas, int n, int[] values, int max, float left, float right, float top, float bottom, Paint fill, Paint line) {
            Path shape = new Path();
            Path area = new Path();
            for (int i = 0; i < n; i++) {
                float x = xAt(i, n, left, right);
                float y = yAt(values[i], max, top, bottom);
                if (i == 0) {
                    shape.moveTo(x, y);
                    area.moveTo(x, y);
                } else {
                    shape.lineTo(x, y);
                    area.lineTo(x, y);
                }
            }
            area.lineTo(xAt(n - 1, n, left, right), bottom);
            area.lineTo(xAt(0, n, left, right), bottom);
            area.close();
            canvas.drawPath(area, fill);
            canvas.drawPath(shape, line);
            if (n <= 12) {
                for (int i = 0; i < n; i++) {
                    float x = xAt(i, n, left, right);
                    float y = yAt(values[i], max, top, bottom);
                    dot.setColor(Color.WHITE);
                    canvas.drawCircle(x, y, dp(3.2f), dot);
                    dot.setColor(line.getColor());
                    canvas.drawCircle(x, y, dp(2.2f), dot);
                }
            }
        }

        private void drawTip(Canvas canvas, int n, float left, float right, float top, float bottom, int max) {
            float x = xAt(highlight, n, left, right);
            canvas.drawLine(x, top, x, bottom, guide);
            float yContact = yAt(contacts[highlight], max, top, bottom);
            float yCompany = yAt(companies[highlight], max, top, bottom);
            dot.setColor(Color.WHITE);
            canvas.drawCircle(x, yContact, dp(4), dot);
            canvas.drawCircle(x, yCompany, dp(4), dot);
            dot.setColor(UiKit.SAGE);
            canvas.drawCircle(x, yContact, dp(2.6f), dot);
            dot.setColor(UiKit.ORANGE);
            canvas.drawCircle(x, yCompany, dp(2.6f), dot);
            String title = shortLabel(buckets[highlight]);
            String line1 = contacts[highlight] + " contacts";
            String line2 = companies[highlight] + " entreprises";
            float width = Math.max(tipText.measureText(title), Math.max(tipText.measureText(line1), tipText.measureText(line2))) + dp(16);
            float height = dp(48);
            float boxLeft = Math.max(left, Math.min(x - width / 2f, right - width));
            float boxTop = Math.max(dp(2), Math.min(yContact, yCompany) - height - dp(8));
            RectF box = new RectF(boxLeft, boxTop, boxLeft + width, boxTop + height);
            canvas.drawRoundRect(box, dp(8), dp(8), tipBg);
            canvas.drawText(title, boxLeft + dp(8), boxTop + dp(14), tipText);
            canvas.drawText(line1, boxLeft + dp(8), boxTop + dp(28), tipText);
            canvas.drawText(line2, boxLeft + dp(8), boxTop + dp(42), tipText);
        }

        private boolean showLabel(int index, int n, float x, float lastLabel, float left, float right) {
            if (n <= 6) return true;
            int step = Math.max(1, (n - 1) / 4);
            if (index % step != 0 && index != n - 1) return false;
            String label = shortLabel(buckets[index]);
            float width = axis.measureText(label);
            float textX = Math.max(left, Math.min(x - width / 2f, right - width));
            return textX >= lastLabel + dp(8);
        }

        private float xAt(int index, int n, float left, float right) {
            if (n <= 1) return (left + right) / 2f;
            return left + (right - left) * index / (n - 1);
        }

        private float yAt(int value, int max, float top, float bottom) {
            return bottom - (bottom - top) * value / (float) Math.max(max, 1);
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            int n = buckets.length;
            if (n == 0) return false;
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getX();
                    downY = event.getY();
                    sliding = false;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = Math.abs(event.getX() - downX);
                    float dy = Math.abs(event.getY() - downY);
                    if (!sliding && dx > dp(6) && dx > dy) {
                        sliding = true;
                        if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                    }
                    if (sliding) select(event.getX());
                    return true;
                case MotionEvent.ACTION_UP:
                    select(event.getX());
                    return true;
                default:
                    return super.onTouchEvent(event);
            }
        }

        private void select(float x) {
            int n = buckets.length;
            float left = dp(28);
            float right = getWidth() - dp(6);
            int nearest = 0;
            float best = Float.MAX_VALUE;
            for (int i = 0; i < n; i++) {
                float distance = Math.abs(xAt(i, n, left, right) - x);
                if (distance < best) {
                    best = distance;
                    nearest = i;
                }
            }
            highlight = nearest;
            setContentDescription(shortLabel(buckets[nearest]) + ", " + contacts[nearest] + " contacts, " + companies[nearest] + " entreprises");
            invalidate();
        }

        private String summary() {
            return "Évolution des contacts et des entreprises créés";
        }

        private float dp(float value) { return value * density; }

        private Paint stroke(int color, float widthDp) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setColor(color);
            paint.setStrokeWidth(widthDp * density);
            return paint;
        }

        private Paint fill(int color) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            return paint;
        }

        private Paint text(int color, float sizeSp) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(color);
            paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sizeSp, getResources().getDisplayMetrics()));
            return paint;
        }
    }

    static final class Bars extends View {
        private final float density;
        private final Paint axis, label, value, bar;
        private String[] names = new String[0];
        private int[] values = new int[0];
        private int[] colors = new int[0];
        private IntConsumer onBucket;

        Bars(Context context) {
            super(context);
            density = context.getResources().getDisplayMetrics().density;
            setClickable(true);
            axis = text(UiKit.MUTED, 10);
            axis.setTextAlign(Paint.Align.RIGHT);
            label = text(UiKit.MUTED, 10);
            label.setTextAlign(Paint.Align.CENTER);
            value = text(UiKit.PETROLEUM, 12);
            value.setFakeBoldText(true);
            value.setTextAlign(Paint.Align.CENTER);
            bar = fill(UiKit.SAGE);
        }

        void setValues(String[] names, int[] values, int[] colors) {
            this.names = names;
            this.values = values;
            this.colors = colors;
            StringBuilder description = new StringBuilder("Relances");
            for (int i = 0; i < names.length && i < values.length; i++) description.append(", ").append(names[i]).append(' ').append(values[i]);
            setContentDescription(description.toString());
            invalidate();
        }

        void setOnBucket(IntConsumer listener) { this.onBucket = listener; }

        @Override protected void onDraw(Canvas canvas) {
            int n = Math.min(names.length, Math.min(values.length, colors.length));
            if (n == 0 || getWidth() == 0) return;
            float left = dp(26);
            float right = getWidth() - dp(4);
            float top = dp(16);
            float bottom = getHeight() - dp(40);
            int max = 0;
            for (int value : values) max = Math.max(max, value);
            max = niceMax(max);
            axis.setTextAlign(Paint.Align.RIGHT);
            for (int tick = 0; tick <= 4; tick++) {
                float y = top + (bottom - top) * (4 - tick) / 4f;
                canvas.drawLine(left, y, right, y, strokeGrid());
                canvas.drawText(String.valueOf(max * tick / 4), left - dp(3), y + dp(3), axis);
            }
            float slot = (right - left) / n;
            float barWidth = Math.min(dp(28), slot * 0.46f);
            for (int i = 0; i < n; i++) {
                float cx = left + slot * i + slot / 2f;
                float y = bottom - (bottom - top) * values[i] / (float) Math.max(max, 1);
                if (values[i] == 0) y = bottom - dp(3);
                bar.setColor(values[i] == 0 ? Color.rgb(226, 232, 230) : colors[i]);
                RectF rect = new RectF(cx - barWidth / 2f, y, cx + barWidth / 2f, bottom);
                canvas.drawRoundRect(rect, dp(5), dp(5), bar);
                canvas.drawRect(rect.left, rect.bottom - dp(6), rect.right, rect.bottom, bar);
                canvas.drawText(String.valueOf(values[i]), cx, y - dp(4), value);
                drawWrapped(canvas, names[i], cx, bottom + dp(14), slot - dp(4));
            }
        }

        private void drawWrapped(Canvas canvas, String text, float cx, float y, float maxWidth) {
            if (label.measureText(text) <= maxWidth) {
                canvas.drawText(text, cx, y, label);
                return;
            }
            int split = text.indexOf(' ');
            if (split > 0) {
                canvas.drawText(text.substring(0, split), cx, y, label);
                canvas.drawText(text.substring(split + 1), cx, y + dp(12), label);
            } else canvas.drawText(text, cx, y, label);
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getActionMasked() != MotionEvent.ACTION_UP || onBucket == null || names.length == 0) return event.getActionMasked() == MotionEvent.ACTION_DOWN;
            float left = dp(26);
            float right = getWidth() - dp(4);
            float slot = (right - left) / names.length;
            int index = (int) ((event.getX() - left) / slot);
            if (index >= 0 && index < names.length) onBucket.accept(index);
            return true;
        }

        private Paint strokeGrid() {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(Color.rgb(226, 232, 230));
            paint.setStrokeWidth(density);
            return paint;
        }

        private float dp(float value) { return value * density; }

        private Paint fill(int color) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(color);
            return paint;
        }

        private Paint text(int color, float sizeSp) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(color);
            paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sizeSp, getResources().getDisplayMetrics()));
            return paint;
        }
    }

    static final class Donut extends View {
        private static final int[] PALETTE = {
            Color.rgb(23, 61, 65),
            Color.rgb(64, 143, 134),
            Color.rgb(104, 173, 165),
            Color.rgb(242, 165, 65),
            Color.rgb(239, 100, 97),
            Color.rgb(100, 116, 139)
        };
        private final float density;
        private final Paint ring, hole, centerValue, centerLabel, legend, legendValue;
        private String[] names = new String[0];
        private int[] counts = new int[0];
        private int total;
        private int selected = -1;

        Donut(Context context) {
            super(context);
            density = context.getResources().getDisplayMetrics().density;
            setClickable(true);
            ring = new Paint(Paint.ANTI_ALIAS_FLAG);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeCap(Paint.Cap.BUTT);
            hole = fill(Color.WHITE);
            centerValue = text(UiKit.PETROLEUM, 18);
            centerValue.setFakeBoldText(true);
            centerValue.setTextAlign(Paint.Align.CENTER);
            centerLabel = text(UiKit.MUTED, 11);
            centerLabel.setTextAlign(Paint.Align.CENTER);
            legend = text(UiKit.PETROLEUM, 12);
            legend.setTextAlign(Paint.Align.LEFT);
            legendValue = text(UiKit.MUTED, 11);
            legendValue.setTextAlign(Paint.Align.LEFT);
        }

        void setSlices(String[] names, int[] counts) {
            this.names = names == null ? new String[0] : names;
            this.counts = counts == null ? new int[0] : counts;
            total = 0;
            for (int count : this.counts) total += Math.max(0, count);
            selected = -1;
            StringBuilder description = new StringBuilder("Répartition, ").append(total).append(" contacts");
            for (int i = 0; i < this.names.length && i < this.counts.length; i++) {
                description.append(", ").append(this.names[i]).append(' ').append(this.counts[i]);
            }
            setContentDescription(description.toString());
            requestLayout();
            invalidate();
        }

        @Override protected void onMeasure(int widthMeasure, int heightMeasure) {
            int width = MeasureSpec.getMode(widthMeasure) == MeasureSpec.UNSPECIFIED ? (int) dp(180) : MeasureSpec.getSize(widthMeasure);
            int rows = Math.max(names.length, 1);
            int desired = (int) (dp(12) + Math.min(dp(112), width * 0.62f) + dp(12) + rows * dp(36));
            setMeasuredDimension(width, resolveSize(desired, heightMeasure));
        }

        @Override protected void onDraw(Canvas canvas) {
            int n = Math.min(names.length, counts.length);
            if (n == 0 || total <= 0 || getWidth() == 0) return;
            float diameter = Math.min(dp(112), getWidth() * 0.62f);
            float cx = getWidth() / 2f;
            float cy = dp(8) + diameter / 2f;
            float stroke = dp(14);
            ring.setStrokeWidth(stroke);
            RectF oval = new RectF(cx - diameter / 2f + stroke / 2f, cy - diameter / 2f + stroke / 2f, cx + diameter / 2f - stroke / 2f, cy + diameter / 2f - stroke / 2f);
            float start = -90f;
            for (int i = 0; i < n; i++) {
                float sweep = counts[i] * 360f / total;
                if (sweep <= 0) continue;
                float gap = n > 1 && sweep > 8 ? 1.2f : 0f;
                ring.setColor(PALETTE[i % PALETTE.length]);
                ring.setStrokeWidth(i == selected ? stroke + dp(3) : stroke);
                canvas.drawArc(oval, start + gap / 2f, Math.max(0.5f, sweep - gap), false, ring);
                start += sweep;
            }
            String totalText = String.valueOf(total);
            canvas.drawText(totalText, cx, cy + dp(2), centerValue);
            canvas.drawText(total > 1 ? "Contacts" : "Contact", cx, cy + dp(16), centerLabel);
            float y = cy + diameter / 2f + dp(16);
            for (int i = 0; i < n; i++) {
                float rowTop = y + i * dp(36);
                ring.setStyle(Paint.Style.FILL);
                ring.setColor(PALETTE[i % PALETTE.length]);
                canvas.drawCircle(dp(8), rowTop + dp(4), dp(4), ring);
                ring.setStyle(Paint.Style.STROKE);
                legend.setFakeBoldText(i == selected);
                String name = statusLabel(names[i]);
                canvas.drawText(ellipsize(legend, name, getWidth() - dp(22)), dp(18), rowTop + dp(8), legend);
                int pct = Math.round(counts[i] * 100f / total);
                canvas.drawText(counts[i] + " · " + pct + " %", dp(18), rowTop + dp(22), legendValue);
            }
        }

        @Override public boolean onTouchEvent(MotionEvent event) {
            if (event.getActionMasked() != MotionEvent.ACTION_UP || total <= 0) return event.getActionMasked() == MotionEvent.ACTION_DOWN;
            float diameter = Math.min(dp(112), getWidth() * 0.62f);
            float cx = getWidth() / 2f;
            float cy = dp(8) + diameter / 2f;
            float dx = event.getX() - cx;
            float dy = event.getY() - cy;
            double distance = Math.hypot(dx, dy);
            int next = -1;
            if (distance >= diameter / 2f - dp(18) && distance <= diameter / 2f + dp(6)) {
                float angle = (float) ((Math.toDegrees(Math.atan2(dy, dx)) + 90 + 360) % 360);
                float cursor = 0;
                for (int i = 0; i < counts.length; i++) {
                    float sweep = counts[i] * 360f / total;
                    if (angle >= cursor && angle < cursor + sweep) { next = i; break; }
                    cursor += sweep;
                }
            } else {
                float legendTop = cy + diameter / 2f + dp(8);
                int row = (int) ((event.getY() - legendTop) / dp(36));
                if (row >= 0 && row < names.length) next = row;
            }
            selected = next;
            invalidate();
            return true;
        }

        private String ellipsize(Paint paint, String text, float max) {
            if (paint.measureText(text) <= max) return text;
            String trimmed = text;
            while (trimmed.length() > 1 && paint.measureText(trimmed + "…") > max) trimmed = trimmed.substring(0, trimmed.length() - 1);
            return trimmed + "…";
        }

        private float dp(float value) { return value * density; }

        private Paint fill(int color) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(color);
            return paint;
        }

        private Paint text(int color, float sizeSp) {
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setColor(color);
            paint.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, sizeSp, getResources().getDisplayMetrics()));
            return paint;
        }
    }

    static String statusLabel(String raw) {
        if (raw == null || raw.isEmpty()) return "";
        return Character.toUpperCase(raw.charAt(0)) + raw.substring(1);
    }
}
