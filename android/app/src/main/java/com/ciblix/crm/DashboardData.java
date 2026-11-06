package com.ciblix.crm;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Complète le tableau de bord lorsque le serveur n’envoie pas encore les séries agrégées. */
final class DashboardData {
    private static final int MAX_PAGES = 1000;
    private static final ZoneId TUNIS = ZoneId.of("Africa/Tunis");

    private DashboardData() {}

    static void enrich(ApiClient api, JSONObject dash) throws Exception {
        try {
            if (!dash.has("followup_flow")) fillFlow(api, dash);
        } catch (ApiClient.Failure failure) {
            if (failure.status == 401) throw failure;
        } catch (Exception ignored) {}
        if (dash.has("portfolio") && dash.has("contact_statuses")) return;
        try {
            JSONArray contacts = fetchAll(api, "contacts");
            if (!dash.has("contact_statuses")) {
                if (contacts == null) dash.put("statuses_skipped", true);
                else dash.put("contact_statuses", statuses(contacts));
            }
            if (!dash.has("portfolio")) {
                JSONArray companies = contacts == null ? null : fetchAll(api, "companies");
                if (contacts == null || companies == null) dash.put("portfolio_skipped", true);
                else dash.put("portfolio", series(contacts, companies));
            }
        } catch (ApiClient.Failure failure) {
            if (failure.status == 401) throw failure;
        } catch (Exception ignored) {}
    }

    private static void fillFlow(ApiClient api, JSONObject dash) throws Exception {
        JSONObject periods = dash.getJSONObject("periods");
        int late = periods.getJSONObject("late").optInt("total");
        int soon = periods.getJSONObject("today").optInt("total") + periods.getJSONObject("upcoming").optInt("total");
        int completed = api.request("GET", "/api/v1/followups?limit=1&status=completed", null).optInt("total");
        dash.put("followup_flow", new JSONObject().put("late", late).put("upcoming", soon).put("completed", completed));
    }

    /** Retourne null au-delà de 1 000 fiches : une série partielle fausserait le graphique. */
    private static JSONArray fetchAll(ApiClient api, String table) throws Exception {
        JSONArray all = new JSONArray();
        int offset = 0;
        while (true) {
            JSONObject page = api.request("GET", "/api/v1/" + table + "?limit=200&offset=" + offset, null);
            int total = page.optInt("total");
            if (total > MAX_PAGES) return null;
            JSONArray items = page.getJSONArray("items");
            for (int i = 0; i < items.length(); i++) all.put(items.get(i));
            offset += items.length();
            if (items.length() == 0 || offset >= total) break;
        }
        return all;
    }

    private static JSONArray statuses(JSONArray contacts) throws Exception {
        Map<String, Integer> counts = new HashMap<>();
        for (int i = 0; i < contacts.length(); i++) {
            JSONObject item = contacts.optJSONObject(i);
            if (item == null) continue;
            String status = item.optString("status", "").trim();
            if (status.isEmpty()) continue;
            counts.put(status, counts.getOrDefault(status, 0) + 1);
        }
        List<String> names = new ArrayList<>(counts.keySet());
        names.sort((a, b) -> {
            int byCount = Integer.compare(counts.get(b), counts.get(a));
            return byCount != 0 ? byCount : a.compareTo(b);
        });
        JSONArray out = new JSONArray();
        for (String name : names) out.put(new JSONObject().put("name", name).put("count", counts.get(name)));
        return out;
    }

    private static JSONObject series(JSONArray contacts, JSONArray companies) throws Exception {
        LocalDate today = LocalDate.now(TUNIS);
        LocalDate startDay = today.minusDays(59);
        YearMonth startMonth = YearMonth.from(today).minusMonths(23);
        int[] dayContacts = new int[60];
        int[] dayCompanies = new int[60];
        int[] monthContacts = new int[24];
        int[] monthCompanies = new int[24];
        tally(contacts, startDay, startMonth, dayContacts, monthContacts);
        tally(companies, startDay, startMonth, dayCompanies, monthCompanies);
        JSONArray days = new JSONArray();
        for (int i = 0; i < 60; i++) {
            days.put(new JSONObject()
                .put("bucket", startDay.plusDays(i).toString())
                .put("contacts", dayContacts[i])
                .put("companies", dayCompanies[i]));
        }
        JSONArray months = new JSONArray();
        for (int i = 0; i < 24; i++) {
            YearMonth month = startMonth.plusMonths(i);
            months.put(new JSONObject()
                .put("bucket", String.format(Locale.US, "%04d-%02d", month.getYear(), month.getMonthValue()))
                .put("contacts", monthContacts[i])
                .put("companies", monthCompanies[i]));
        }
        return new JSONObject().put("days", days).put("months", months);
    }

    private static void tally(JSONArray items, LocalDate startDay, YearMonth startMonth, int[] days, int[] months) {
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null) continue;
            OffsetDateTime time = parseTime(item.optString("created_at", ""));
            if (time == null) continue;
            LocalDate day = time.atZoneSameInstant(TUNIS).toLocalDate();
            int dayIndex = (int) ChronoUnit.DAYS.between(startDay, day);
            if (dayIndex >= 0 && dayIndex < days.length) days[dayIndex]++;
            int monthIndex = (int) ChronoUnit.MONTHS.between(startMonth, YearMonth.from(day));
            if (monthIndex >= 0 && monthIndex < months.length) months[monthIndex]++;
        }
    }

    private static OffsetDateTime parseTime(String raw) {
        if (raw == null || raw.isEmpty()) return null;
        try { return OffsetDateTime.parse(raw); }
        catch (Exception ignored) {}
        try { return Instant.parse(raw).atOffset(ZoneOffset.UTC); }
        catch (Exception ignored) {}
        return null;
    }
}
