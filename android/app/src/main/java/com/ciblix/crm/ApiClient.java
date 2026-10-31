package com.ciblix.crm;

import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;

final class ApiClient {
    volatile String base, token = "";
    ApiClient(String base) { this.base = base; }
    static String validateBase(String value, boolean debug) {
        URI uri = URI.create(value.trim());
        String host = uri.getHost();
        boolean local = "127.0.0.1".equals(host) || "localhost".equals(host) || "10.0.2.2".equals(host);
        if (host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
            !("https".equals(uri.getScheme()) || debug && local && "http".equals(uri.getScheme())) ||
            !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) throw new IllegalArgumentException("Indiquez une origine HTTPS (ou localhost en développement).");
        return value.trim().replaceAll("/+$", "");
    }
    static final class Failure extends Exception {
        final int status;
        Failure(int status, String message) { super(message); this.status = status; }
    }
    JSONObject request(String method, String path, JSONObject body) throws Exception {
        return request(method, path, body, 20000);
    }
    JSONObject request(String method, String path, JSONObject body, int readTimeoutMs) throws Exception {
        HttpURLConnection c = (HttpURLConnection) URI.create(base + path).toURL().openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(Math.max(20000, readTimeoutMs)); c.setInstanceFollowRedirects(false);
        c.setRequestMethod(method); c.setRequestProperty("Accept", "application/json");
        if (!token.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + token);
        try {
            if (body != null) {
                c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json");
                try (var out = c.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int status = c.getResponseCode();
            InputStream stream = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String raw = "";
            if (stream != null) try (stream) { java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream(); byte[] chunk = new byte[8192]; int n; while ((n = stream.read(chunk)) != -1) buffer.write(chunk, 0, n); raw = buffer.toString("UTF-8"); }
            JSONObject result;
            try { result = raw.trim().isEmpty() ? new JSONObject() : new JSONObject(raw); }
            catch (Exception e) { throw new Failure(status, "Réponse serveur invalide (" + status + ")."); }
            if (status < 200 || status >= 300) throw new Failure(status, result.optString("message", "Demande refusée (" + status + ")."));
            if (path.equals("/api/auth/sign-in/email")) {
                String signed = c.getHeaderField("set-auth-token");
                if (signed == null || signed.trim().isEmpty()) throw new Failure(401, "Le serveur n’a pas fourni de session signée.");
                token = signed;
            }
            return result;
        } finally { c.disconnect(); }
    }
}
