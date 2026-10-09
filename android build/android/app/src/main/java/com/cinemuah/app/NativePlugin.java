package com.cinemuah.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.view.WindowManager;

import androidx.core.app.ActivityCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Bridge between the shared web UI and the native engine (see shim/native.ts for the JS side). */
@CapacitorPlugin(name = "CinemuahNative")
public class NativePlugin extends Plugin {
    private final ExecutorService io = Executors.newCachedThreadPool();
    private StreamServer server;

    @Override
    public void load() {
        try {
            server = new StreamServer(getContext());
            server.start();
        } catch (Exception e) {
            server = null;
        }
        TorrentEngine.get(getContext()).setFinishedListener(info -> {
            try { notifyListeners("downloadFinished", new JSObject(info.toString())); } catch (Exception ignored) { /* UI may be gone */ }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1001);
        }
    }

    private void fail(PluginCall call, Exception e) {
        call.reject(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
    }

    // ── network ──

    @PluginMethod
    public void httpGet(PluginCall call) {
        final String url = call.getString("url");
        final int timeout = call.getInt("timeoutMs", 12000);
        final java.util.Map<String, String> headers = readHeaders(call.getObject("headers"));
        io.execute(() -> {
            try {
                Net.Result r = Net.getText(url, timeout, headers);
                JSObject o = new JSObject();
                o.put("status", r.status);
                o.put("body", r.body);
                call.resolve(o);
            } catch (Exception e) { fail(call, e); }
        });
    }

    private static java.util.Map<String, String> readHeaders(JSObject o) {
        if (o == null) return null;
        java.util.Map<String, String> m = new java.util.HashMap<>();
        java.util.Iterator<String> keys = o.keys();
        while (keys.hasNext()) { String k = keys.next(); m.put(k, o.optString(k)); }
        return m;
    }

    /** Binary GET (subtitle archives): returns the status and the body as base64. */
    @PluginMethod
    public void httpGetBytes(PluginCall call) {
        final String url = call.getString("url");
        final int timeout = call.getInt("timeoutMs", 20000);
        final java.util.Map<String, String> headers = readHeaders(call.getObject("headers"));
        io.execute(() -> {
            try {
                int[] status = new int[1];
                byte[] body = Net.getBytesAny(url, timeout, headers, status);
                JSObject o = new JSObject();
                o.put("status", status[0]);
                o.put("base64", android.util.Base64.encodeToString(body, android.util.Base64.NO_WRAP));
                call.resolve(o);
            } catch (Exception e) { fail(call, e); }
        });
    }

    @PluginMethod
    public void getPort(PluginCall call) {
        JSObject o = new JSObject();
        o.put("port", server != null ? server.port() : 0);
        call.resolve(o);
    }

    // ── streaming ──

    @PluginMethod
    public void torrentStart(PluginCall call) {
        final String magnet = call.getString("magnet");
        io.execute(() -> {
            try { call.resolve(new JSObject(TorrentEngine.get(getContext()).startStream(magnet).toString())); }
            catch (Exception e) { fail(call, e); }
        });
    }

    @PluginMethod
    public void torrentStats(PluginCall call) {
        try { call.resolve(new JSObject(TorrentEngine.get(getContext()).streamStats().toString())); }
        catch (Exception e) { fail(call, e); }
    }

    @PluginMethod
    public void torrentStop(PluginCall call) {
        io.execute(() -> { TorrentEngine.get(getContext()).stopStream(); call.resolve(); });
    }

    // ── downloads ──

    @PluginMethod
    public void downloadStart(PluginCall call) {
        try {
            JSObject data = call.getData();
            JSONObject meta = new JSONObject(data.toString());
            JSONObject info = TorrentEngine.get(getContext()).startDownload(data.getString("magnet"), meta);
            call.resolve(new JSObject(info.toString()));
        } catch (Exception e) { fail(call, e); }
    }

    @PluginMethod
    public void downloadsList(PluginCall call) {
        try {
            JSArray arr = new JSArray();
            List<JSONObject> items = TorrentEngine.get(getContext()).listDownloads();
            for (JSONObject o : items) arr.put(o);
            JSObject res = new JSObject();
            res.put("items", arr);
            call.resolve(res);
        } catch (Exception e) { fail(call, e); }
    }

    @PluginMethod
    public void downloadCancel(PluginCall call) {
        final String hash = call.getString("hash");
        io.execute(() -> { TorrentEngine.get(getContext()).cancelDownload(hash); call.resolve(); });
    }

    @PluginMethod
    public void downloadPause(PluginCall call) { TorrentEngine.get(getContext()).pauseDownload(call.getString("hash")); call.resolve(); }

    @PluginMethod
    public void downloadResume(PluginCall call) { TorrentEngine.get(getContext()).resumeDownload(call.getString("hash")); call.resolve(); }

    @PluginMethod
    public void downloadsClear(PluginCall call) { TorrentEngine.get(getContext()).clearFinished(); call.resolve(); }

    // ── library ──

    @PluginMethod
    public void libraryList(PluginCall call) {
        io.execute(() -> {
            try {
                JSArray arr = new JSArray();
                for (Library.Item it : Library.list(getContext())) {
                    JSObject o = new JSObject();
                    o.put("id", it.id);
                    o.put("path", it.path);
                    o.put("name", it.name);
                    o.put("size", it.size);
                    o.put("modified", it.modified);
                    arr.put(o);
                }
                JSObject res = new JSObject();
                res.put("items", arr);
                call.resolve(res);
            } catch (Exception e) { fail(call, e); }
        });
    }

    @PluginMethod
    public void libraryDelete(PluginCall call) {
        final int id = call.getInt("id", 0);
        io.execute(() -> { Library.delete(getContext(), id); call.resolve(); });
    }

    // ── device ──

    @PluginMethod
    public void setPlayerMode(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            try {
                android.app.Activity a = getActivity();
                WindowInsetsControllerCompat c = WindowCompat.getInsetsController(a.getWindow(), a.getWindow().getDecorView());
                if (on) {
                    a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(WindowInsetsCompat.Type.systemBars());
                    a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    a.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    c.show(WindowInsetsCompat.Type.systemBars());
                    a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            } catch (Exception ignored) { /* cosmetic */ }
            call.resolve();
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url")));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { fail(call, e); }
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) server.stop();
        super.handleOnDestroy();
    }
}
