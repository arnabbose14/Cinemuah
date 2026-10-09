package com.cinemuah.app;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.dnsoverhttps.DnsOverHttps;

/**
 * HTTP client that resolves names over DNS-over-HTTPS (Cloudflare) before falling back to the
 * system resolver. Some ISPs poison DNS for the movie/series sites; this goes around that.
 */
public final class Net {
    private Net() {}

    private static OkHttpClient client;

    public static synchronized OkHttpClient client() {
        if (client == null) {
            OkHttpClient bootstrap = new OkHttpClient.Builder()
                    .connectTimeout(6, TimeUnit.SECONDS)
                    .readTimeout(6, TimeUnit.SECONDS)
                    .build();
            final DnsOverHttps doh = new DnsOverHttps.Builder()
                    .client(bootstrap)
                    .url(HttpUrl.get("https://cloudflare-dns.com/dns-query"))
                    .bootstrapDnsHosts(Arrays.asList(
                            ipv4(1, 1, 1, 1), ipv4(1, 0, 0, 1)))
                    .includeIPv6(false)
                    .build();

            Dns dns = new Dns() {
                @Override
                public List<InetAddress> lookup(String hostname) throws UnknownHostException {
                    try {
                        List<InetAddress> secure = doh.lookup(hostname);
                        if (!secure.isEmpty()) return secure;
                    } catch (UnknownHostException ignored) {
                        // fall through to the system resolver
                    }
                    return Dns.SYSTEM.lookup(hostname);
                }
            };

            client = new OkHttpClient.Builder()
                    .dns(dns)
                    .connectTimeout(10, TimeUnit.SECONDS)
                    .readTimeout(15, TimeUnit.SECONDS)
                    .followRedirects(true)
                    .build();
        }
        return client;
    }

    private static InetAddress ipv4(int a, int b, int c, int d) {
        try {
            return InetAddress.getByAddress(new byte[]{(byte) a, (byte) b, (byte) c, (byte) d});
        } catch (UnknownHostException e) {
            throw new IllegalStateException(e);
        }
    }

    public static final class Result {
        public final int status;
        public final String body;
        public Result(int status, String body) { this.status = status; this.body = body; }
    }

    /** GET as text (JSON APIs). */
    public static Result getText(String url, int timeoutMs) throws IOException {
        return getText(url, timeoutMs, null);
    }

    /** GET as text with extra request headers (e.g. the subtitle service's X-User-Agent). */
    public static Result getText(String url, int timeoutMs, java.util.Map<String, String> headers) throws IOException {
        OkHttpClient c = client().newBuilder()
                .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
        Request.Builder rb = new Request.Builder().url(url)
                .header("User-Agent", "Cinemuah/1.0 (Android)")
                .header("Accept", "application/json,*/*");
        if (headers != null) for (java.util.Map.Entry<String, String> h : headers.entrySet()) rb.header(h.getKey(), h.getValue());
        Request req = rb.build();
        try (Response res = c.newCall(req).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            return new Result(res.code(), body);
        }
    }

    /** GET as bytes for the web layer (status + raw body), with extra headers. */
    public static byte[] getBytesAny(String url, int timeoutMs, java.util.Map<String, String> headers, int[] statusOut) throws IOException {
        OkHttpClient c = client().newBuilder().callTimeout(timeoutMs, TimeUnit.MILLISECONDS).build();
        Request.Builder rb = new Request.Builder().url(url).header("User-Agent", "Cinemuah/1.0 (Android)");
        if (headers != null) for (java.util.Map.Entry<String, String> h : headers.entrySet()) rb.header(h.getKey(), h.getValue());
        try (Response res = c.newCall(rb.build()).execute()) {
            statusOut[0] = res.code();
            return res.body() != null ? res.body().bytes() : new byte[0];
        }
    }

    /** GET as bytes (images). Only 200 responses are returned. */
    public static byte[] getBytes(String url, int timeoutMs, long maxBytes) throws IOException {
        OkHttpClient c = client().newBuilder()
                .callTimeout(timeoutMs, TimeUnit.MILLISECONDS)
                .build();
        Request req = new Request.Builder().url(url).header("User-Agent", "Cinemuah/1.0 (Android)").build();
        try (Response res = c.newCall(req).execute()) {
            if (res.code() != 200 || res.body() == null) throw new IOException("HTTP " + res.code());
            long len = res.body().contentLength();
            if (len > maxBytes) throw new IOException("Too large");
            return res.body().bytes();
        }
    }
}
