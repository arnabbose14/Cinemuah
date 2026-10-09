package com.cinemuah.app;

import android.content.Context;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import fi.iki.elonen.NanoHTTPD;

/**
 * Loopback-only HTTP server the WebView talks to:
 *   /torrent/{hash}/{file}  byte-range stream of a torrent video file (while it downloads)
 *   /media/{id}             byte-range stream of a downloaded library file
 *   /yts-image?u=...        poster artwork, fetched around ISP DNS blocking and cached on disk
 *   /info/...               "direct play" answer for the shared player (no transcoding on Android)
 */
public final class StreamServer extends NanoHTTPD {
    private static final Pattern TORRENT = Pattern.compile("^/torrent/([0-9a-fA-F]{40})/(\\d+)$");
    private static final Pattern MEDIA = Pattern.compile("^/media/(\\d+)$");
    private static final Pattern INFO = Pattern.compile("^/info/(media/\\d+|torrent/[0-9a-fA-F]{40}/\\d+)$");
    private static final Pattern IMAGE_HOST = Pattern.compile("^(?:[a-z0-9-]+\\.)*(?:yts\\.[a-z]+|accel\\.li|tvmaze\\.com)$", Pattern.CASE_INSENSITIVE);

    private final Context ctx;
    private final File imageDir;

    public StreamServer(Context ctx) {
        super("127.0.0.1", 0);
        this.ctx = ctx.getApplicationContext();
        this.imageDir = new File(this.ctx.getCacheDir(), "images");
        //noinspection ResultOfMethodCallIgnored
        imageDir.mkdirs();
    }

    public int port() { return getListeningPort(); }

    private Response cors(Response r) {
        r.addHeader("Access-Control-Allow-Origin", "*");
        r.addHeader("Access-Control-Allow-Headers", "Range, Content-Type");
        r.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        r.addHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");
        r.addHeader("Accept-Ranges", "bytes");
        return r;
    }

    private Response text(Response.IStatus status, String body) {
        return cors(newFixedLengthResponse(status, "text/plain", body));
    }

    @Override
    public Response serve(IHTTPSession session) {
        try {
            if (session.getMethod() == Method.OPTIONS) return cors(newFixedLengthResponse(Response.Status.OK, "text/plain", ""));

            String uri = session.getUri();
            Matcher m;

            if ("/yts-image".equals(uri)) return serveImage(session);

            if ((m = INFO.matcher(uri)).matches()) {
                return cors(newFixedLengthResponse(Response.Status.OK, "application/json",
                        "{\"duration\":0,\"video\":\"\",\"audio\":\"\",\"container\":\"\",\"direct\":true}"));
            }

            if ((m = TORRENT.matcher(uri)).matches()) {
                String hash = m.group(1).toLowerCase(Locale.ROOT);
                int idx = Integer.parseInt(m.group(2));
                TorrentEngine engine = TorrentEngine.get(ctx);
                long size = engine.fileSizeOf(hash, idx);
                if (size < 0) return text(Response.Status.NOT_FOUND, "Stream not active");
                String name = engine.fileNameOf(hash, idx);
                return ranged(session, size, Library.mime(name), start -> engine.openRange(hash, idx, start));
            }

            if ((m = MEDIA.matcher(uri)).matches()) {
                Library.Item item = Library.find(Integer.parseInt(m.group(1)));
                if (item == null) { Library.list(ctx); item = Library.find(Integer.parseInt(m.group(1))); }
                if (item == null) return text(Response.Status.NOT_FOUND, "Not found");
                final Library.Item it = item;
                return ranged(session, it.size, Library.mime(it.name), start -> Library.open(ctx, it, start));
            }

            return text(Response.Status.NOT_FOUND, "Not Found");
        } catch (Exception e) {
            return text(Response.Status.INTERNAL_ERROR, String.valueOf(e.getMessage()));
        }
    }

    private interface Opener { InputStream open(long start) throws IOException; }

    private Response ranged(IHTTPSession session, long size, String mime, Opener opener) throws IOException {
        String range = header(session, "range");
        long start = 0, end = size - 1;
        boolean partial = false;

        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6).split(",")[0].trim();
            int dash = spec.indexOf('-');
            try {
                String a = spec.substring(0, dash), b = spec.substring(dash + 1);
                if (a.isEmpty()) { start = Math.max(0, size - Long.parseLong(b)); }
                else { start = Long.parseLong(a); if (!b.isEmpty()) end = Math.min(Long.parseLong(b), size - 1); }
                partial = true;
            } catch (Exception e) {
                return cors(newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", ""));
            }
            if (start >= size || start > end) {
                Response r = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "");
                r.addHeader("Content-Range", "bytes */" + size);
                return cors(r);
            }
        }

        long length = end - start + 1;
        if (session.getMethod() == Method.HEAD) {
            // NanoHTTPD derives Content-Length from the declared size and sends no body for HEAD
            Response r = newFixedLengthResponse(partial ? Response.Status.PARTIAL_CONTENT : Response.Status.OK, mime,
                    new ByteArrayInputStream(new byte[0]), length);
            if (partial) r.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
            return cors(r);
        }

        InputStream in = opener.open(start);
        if (in == null) return text(Response.Status.NOT_FOUND, "Stream not active");
        Response r = newFixedLengthResponse(partial ? Response.Status.PARTIAL_CONTENT : Response.Status.OK, mime,
                new LimitedStream(in, length), length);
        if (partial) r.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
        r.addHeader("Cache-Control", "no-cache");
        return cors(r);
    }

    private static String header(IHTTPSession s, String name) {
        Map<String, String> h = s.getHeaders();
        return h == null ? null : h.get(name);
    }

    /** Stops after `remaining` bytes so a ranged response never over-reads the source. */
    private static final class LimitedStream extends InputStream {
        private final InputStream in;
        private long remaining;
        LimitedStream(InputStream in, long length) { this.in = in; this.remaining = length; }
        @Override public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = in.read();
            if (b >= 0) remaining--;
            return b;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, remaining));
            if (n > 0) remaining -= n;
            return n;
        }
        @Override public void close() throws IOException { in.close(); }
    }

    // ─── image proxy ────────────────────────────────────────────────

    private Response serveImage(IHTTPSession session) {
        java.util.List<String> us = session.getParameters().get("u");
        if (us == null || us.isEmpty()) return text(Response.Status.BAD_REQUEST, "missing u");
        String url = us.get(0);
        try {
            java.net.URI u = java.net.URI.create(url);
            if (!"https".equals(u.getScheme()) || u.getHost() == null || !IMAGE_HOST.matcher(u.getHost()).matches()) {
                return text(Response.Status.FORBIDDEN, "Host not allowed");
            }
            File f = new File(imageDir, sha1(url));
            byte[] body;
            if (f.exists() && f.length() > 0) {
                body = readFile(f);
            } else {
                body = Net.getBytes(url, 10000, 8 * 1024 * 1024);
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(body); } catch (IOException ignored) { /* cache is best effort */ }
            }
            Response r = newFixedLengthResponse(Response.Status.OK, sniff(body), new ByteArrayInputStream(body), body.length);
            r.addHeader("Cache-Control", "max-age=86400");
            return cors(r);
        } catch (Exception e) {
            return text(Response.Status.NOT_FOUND, "");
        }
    }

    private static byte[] readFile(File f) throws IOException {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream((int) f.length());
            byte[] buf = new byte[32 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static String sniff(byte[] b) {
        if (b.length > 3 && (b[0] & 0xff) == 0x89 && b[1] == 'P') return "image/png";
        if (b.length > 3 && b[0] == 'R' && b[1] == 'I') return "image/webp";
        return "image/jpeg";
    }

    private static String sha1(String s) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-1").digest(s.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte x : d) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
