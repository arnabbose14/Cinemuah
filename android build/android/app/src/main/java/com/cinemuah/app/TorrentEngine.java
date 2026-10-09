package com.cinemuah.app;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;
import org.libtorrent4j.FileStorage;
import org.libtorrent4j.Priority;
import org.libtorrent4j.SessionHandle;
import org.libtorrent4j.SessionManager;
import org.libtorrent4j.TorrentFlags;
import org.libtorrent4j.TorrentHandle;
import org.libtorrent4j.TorrentInfo;
import org.libtorrent4j.TorrentStatus;
import org.libtorrent4j.TcpEndpoint;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * libtorrent-based engine: one session shared by the (single) active stream and any number of downloads.
 * Streaming downloads the chosen video file sequentially and serves byte ranges while it is still incomplete.
 */
public final class TorrentEngine {
    private static TorrentEngine instance;

    public static synchronized TorrentEngine get(Context ctx) {
        if (instance == null) instance = new TorrentEngine(ctx.getApplicationContext());
        return instance;
    }

    public interface FinishedListener { void onFinished(JSONObject info); }

    private static final Pattern HASH = Pattern.compile("btih:([0-9a-fA-F]{40})");
    private static final String[] VIDEO_EXT = {".mp4", ".mkv", ".webm", ".m4v", ".mov", ".avi"};
    private static final int WINDOW = 10; // pieces ahead of the playhead that get a deadline

    private final Context app;
    private final SessionManager sm = new SessionManager();
    private final ScheduledExecutorService ticker = Executors.newSingleThreadScheduledExecutor();
    private final Map<String, Download> downloads = new ConcurrentHashMap<>();
    private volatile FinishedListener finishedListener;

    // active stream (written under the monitor, readable without it)
    private volatile TorrentHandle sHandle;
    private volatile TorrentInfo sInfo;
    private volatile int sFile = -1;
    private volatile String sHash = "";
    private volatile boolean sShared;
    private int streamGeneration;     // bumped by every start/stop so a slow start can tell it was superseded
    private int lastServiceCount = -1;
    private volatile long lastRangeStart = -1;   // where the player last asked to read, to detect big seeks

    private TorrentEngine(Context ctx) {
        this.app = ctx;
        // Partial downloads and stream caches are not resumed after a restart; if the system killed the app
        // earlier they were left behind, so clear them (they can be gigabytes).
        for (String kind : new String[]{"stream", "downloads", "magnet"}) {
            File[] leftovers = root(kind).listFiles();
            if (leftovers != null) for (File f : leftovers) deleteRecursive(f);
        }
        sm.start();
        sm.maxActiveDownloads(50);
        sm.maxActiveSeeds(0);
        ticker.scheduleWithFixedDelay(this::tick, 1, 1, TimeUnit.SECONDS);
    }

    public void setFinishedListener(FinishedListener l) { this.finishedListener = l; }

    // ─── helpers ────────────────────────────────────────────────────

    static String hashOf(String magnet) {
        Matcher m = HASH.matcher(magnet);
        return m.find() ? m.group(1).toLowerCase(Locale.ROOT) : "";
    }

    /** Direct peer hints in a magnet link (x.pe=host:port), which libtorrent does not carry over from the metadata fetch. */
    private static List<TcpEndpoint> peerHints(String magnet) {
        List<TcpEndpoint> peers = new ArrayList<>();
        Matcher m = Pattern.compile("[?&]x\\.pe=([^&]+)").matcher(magnet);
        while (m.find()) {
            try {
                String hp = java.net.URLDecoder.decode(m.group(1), "UTF-8");
                int colon = hp.lastIndexOf(':');
                if (colon > 0) peers.add(new TcpEndpoint(hp.substring(0, colon), Integer.parseInt(hp.substring(colon + 1))));
            } catch (Exception ignored) { /* malformed hint */ }
        }
        return peers.isEmpty() ? null : peers;
    }

    private static int bestVideoFile(TorrentInfo ti) {
        FileStorage fs = ti.files();
        int best = -1;
        for (int i = 0; i < fs.numFiles(); i++) {
            String n = fs.fileName(i).toLowerCase(Locale.ROOT);
            boolean video = false;
            for (String ext : VIDEO_EXT) if (n.endsWith(ext)) { video = true; break; }
            if (video && (best < 0 || fs.fileSize(i) > fs.fileSize(best))) best = i;
        }
        return best;
    }

    private static Priority[] onlyFile(int count, int file) {
        Priority[] p = Priority.array(Priority.IGNORE, count);
        p[file] = Priority.DEFAULT;
        return p;
    }

    private File root(String kind) {
        File base = app.getExternalFilesDir(null);
        if (base == null) base = app.getFilesDir();
        File dir = new File(base, kind);
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    private TorrentHandle awaitHandle(TorrentInfo ti) throws IOException {
        for (int i = 0; i < 100; i++) {
            TorrentHandle h = sm.find(ti.infoHash());
            if (h != null && h.isValid()) return h;
            try { Thread.sleep(50); } catch (InterruptedException e) { throw new IOException("Interrupted"); }
        }
        throw new IOException("Could not start the torrent");
    }

    private TorrentInfo fetchInfo(String magnet, int timeoutSec) throws IOException {
        byte[] data = sm.fetchMagnet(magnet, timeoutSec, root("magnet"));
        if (data == null) throw new IOException("Timed out finding peers for this torrent. Try another quality.");
        return TorrentInfo.bdecode(data);
    }

    /**
     * fetchMagnet() leaves a temporary "metadata only" torrent in the session and removes it asynchronously.
     * SessionManager.download() silently only re-prioritises an existing torrent with the same hash, so adding
     * the real one before that removal finished would leave a paused torrent that never downloads.
     */
    private void awaitTempTorrentGone(TorrentInfo ti) throws IOException {
        for (int i = 0; i < 80; i++) {
            TorrentHandle h = sm.find(ti.infoHash());
            if (h == null || !h.isValid()) return;
            if (i == 10 || i == 40) {
                try { sm.remove(h); } catch (Exception ignored) { /* already being removed */ }
            }
            try { Thread.sleep(50); } catch (InterruptedException e) { throw new IOException("Interrupted"); }
        }
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    // ─── streaming ──────────────────────────────────────────────────

    public JSONObject startStream(String magnet) throws IOException, JSONException {
        final String hash = hashOf(magnet);
        if (hash.isEmpty()) throw new IOException("Invalid magnet link");

        final int gen;
        synchronized (this) {
            stopStream();
            gen = ++streamGeneration;
        }

        TorrentHandle handle;
        TorrentInfo info;
        int file;
        boolean shared = false;

        Download dl = downloads.get(hash);
        if (dl != null && dl.th != null && dl.ti != null && !"error".equals(dl.status) && !"done".equals(dl.status)) {
            // Already downloading this movie: stream from the download
            handle = dl.th; info = dl.ti; file = dl.fileIndex; shared = true;
        } else {
            info = fetchInfo(magnet, 45);                       // slow: no lock held
            awaitTempTorrentGone(info);
            file = bestVideoFile(info);
            if (file < 0) throw new IOException("No playable video file found in this torrent.");
            File dir = new File(root("stream"), hash);
            sm.download(info, dir, null, onlyFile(info.numFiles(), file), peerHints(magnet), TorrentFlags.SEQUENTIAL_DOWNLOAD);
            handle = awaitHandle(info);
        }

        synchronized (this) {
            if (gen != streamGeneration) {
                // The user started something else (or stopped) while this one was connecting
                if (!shared) {
                    try { sm.remove(handle, SessionHandle.DELETE_FILES); } catch (Exception ignored) { /* gone */ }
                    deleteRecursive(new File(root("stream"), hash));
                }
                throw new IOException("Cancelled");
            }
            sHandle = handle; sInfo = info; sFile = file; sShared = shared; sHash = hash;
        }

        // Pieces at the start (headers) and end (MP4 index) are needed before playback can begin
        FileStorage fs = info.files();
        long off = fs.fileOffset(file), size = fs.fileSize(file);
        int pl = info.pieceLength();
        int first = (int) (off / pl), last = (int) ((off + size - 1) / pl);
        for (int i = 0; i < 4 && first + i <= last; i++) handle.setPieceDeadline(first + i, 150 + i * 200);
        handle.setPieceDeadline(last, 600);

        JSONObject o = new JSONObject();
        o.put("infoHash", hash);
        o.put("fileIndex", file);
        o.put("fileName", fs.fileName(file));
        o.put("fileSize", size);
        o.put("streamPath", "/torrent/" + hash + "/" + file);
        return o;
    }

    public synchronized void stopStream() {
        streamGeneration++;
        TorrentHandle h = sHandle;
        boolean shared = sShared;
        String hash = sHash;
        sHandle = null; sInfo = null; sFile = -1; sShared = false; sHash = "";
        if (h != null && !shared) {
            try { sm.remove(h, SessionHandle.DELETE_FILES); } catch (Exception ignored) { /* already gone */ }
            deleteRecursive(new File(root("stream"), hash));
        }
    }

    public JSONObject streamStats() {
        JSONObject o = new JSONObject();
        try {
            final TorrentHandle h = sHandle;
            final TorrentInfo ti = sInfo;
            final int file = sFile;
            if (h == null || ti == null || file < 0 || !h.isValid()) { o.put("active", false); return o; }
            TorrentStatus st = h.status();
            long size = ti.files().fileSize(file);
            long[] fp = h.fileProgress();
            long done = file < fp.length ? fp[file] : 0;
            o.put("active", true);
            o.put("infoHash", sHash);
            o.put("ready", true);
            o.put("progress", st.progress());
            o.put("fileProgress", size > 0 ? (double) done / size : 0);
            o.put("downloadSpeed", st.downloadRate());
            o.put("uploadSpeed", 0);
            o.put("peers", st.numPeers());
            o.put("downloaded", done);
            o.put("fileSize", size);
        } catch (JSONException ignored) { /* cannot happen for plain values */ }
        return o;
    }

    /** Byte range [start, end] (inclusive) of a streamed file, or null if that stream is not active. */
    public synchronized InputStream openRange(String hash, int fileIndex, long start) throws IOException {
        TorrentHandle h = null; TorrentInfo ti = null; File base = null;
        if (sHandle != null && hash.equals(sHash) && fileIndex == sFile) {
            h = sHandle; ti = sInfo;
            base = sShared ? stagingDirFor(hash) : new File(root("stream"), hash);
        } else {
            Download d = downloads.get(hash);
            if (d != null && d.th != null && d.ti != null && d.fileIndex == fileIndex) { h = d.th; ti = d.ti; base = d.stagingDir; }
        }
        if (h == null) return null;
        // A big jump (a seek) leaves deadlines on pieces nobody needs any more; they would keep competing for bandwidth
        if (lastRangeStart >= 0 && Math.abs(start - lastRangeStart) > 8L * 1024 * 1024) {
            try { h.clearPieceDeadlines(); } catch (Exception ignored) { /* best effort */ }
        }
        lastRangeStart = start;
        return new RangeStream(h, ti, new File(base, ti.files().filePath(fileIndex)), fileIndex, start);
    }

    public synchronized long fileSizeOf(String hash, int fileIndex) {
        if (sHandle != null && hash.equals(sHash) && fileIndex == sFile) return sInfo.files().fileSize(fileIndex);
        Download d = downloads.get(hash);
        if (d != null && d.ti != null && d.fileIndex == fileIndex) return d.ti.files().fileSize(fileIndex);
        return -1;
    }

    public synchronized String fileNameOf(String hash, int fileIndex) {
        if (sHandle != null && hash.equals(sHash) && fileIndex == sFile) return sInfo.files().fileName(fileIndex);
        Download d = downloads.get(hash);
        if (d != null && d.ti != null && d.fileIndex == fileIndex) return d.ti.files().fileName(fileIndex);
        return "video.mp4";
    }

    private File stagingDirFor(String hash) {
        return new File(root("downloads"), hash);
    }

    /** Blocking stream over a torrent file: waits for the pieces a read needs and prioritizes them. */
    private final class RangeStream extends InputStream {
        private final TorrentHandle th;
        private final TorrentInfo ti;
        private final File file;
        private final long fileOffset;
        private final int pieceLen;
        private long pos;
        private RandomAccessFile raf;
        private int lastDeadlinePiece = -1;

        RangeStream(TorrentHandle th, TorrentInfo ti, File file, int fileIndex, long start) {
            this.th = th; this.ti = ti; this.file = file;
            this.fileOffset = ti.files().fileOffset(fileIndex);
            this.pieceLen = ti.pieceLength();
            this.pos = start;
        }

        private void prioritize(int piece, int lastPiece) {
            if (piece == lastDeadlinePiece) return;
            lastDeadlinePiece = piece;
            for (int i = 0; i < WINDOW && piece + i <= lastPiece; i++) {
                if (!th.havePiece(piece + i)) th.setPieceDeadline(piece + i, 100 + i * 250);
            }
        }

        @Override public int read() throws IOException {
            byte[] one = new byte[1];
            int n = read(one, 0, 1);
            return n <= 0 ? -1 : one[0] & 0xff;
        }

        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (len == 0) return 0;
            long global = fileOffset + pos;
            int piece = (int) (global / pieceLen);
            int inPiece = (int) (global % pieceLen);
            int lastPiece = ti.numPieces() - 1;
            prioritize(piece, lastPiece);

            long deadline = System.currentTimeMillis() + 120_000;
            while (!th.havePiece(piece)) {
                if (System.currentTimeMillis() > deadline) throw new IOException("Timed out waiting for data");
                try { Thread.sleep(80); } catch (InterruptedException e) { throw new IOException("Interrupted"); }
                if (!th.isValid()) throw new IOException("Torrent stopped");
            }

            int want = Math.min(len, pieceLen - inPiece);
            if (raf == null) raf = new RandomAccessFile(file, "r");
            // The file may lag the piece map briefly; retry until the bytes are on disk
            for (int attempt = 0; attempt < 100; attempt++) {
                raf.seek(pos);
                int n = raf.read(b, off, want);
                if (n > 0) { pos += n; return n; }
                try { Thread.sleep(50); } catch (InterruptedException e) { throw new IOException("Interrupted"); }
            }
            throw new IOException("Data not available on disk");
        }

        @Override public void close() throws IOException {
            if (raf != null) raf.close();
        }
    }

    // ─── downloads ──────────────────────────────────────────────────

    static final class Download {
        String hash, title, quality, status = "metadata", error, savedPath;
        int year;
        String showTitle; int season, episode;
        volatile TorrentHandle th;
        volatile TorrentInfo ti;
        int fileIndex;
        File stagingDir;
        long size, downloaded;
        double progress;
        int speed, peers;
        boolean paused;
        List<TcpEndpoint> hints;   // direct peer hints from the magnet link, re-used when resuming
    }

    public synchronized JSONObject startDownload(String magnet, JSONObject meta) throws IOException, JSONException {
        final String hash = hashOf(magnet);
        if (hash.isEmpty()) throw new IOException("Invalid magnet link");
        Download existing = downloads.get(hash);
        if (existing != null && !"error".equals(existing.status)) return toJson(existing);

        final Download d = new Download();
        d.hash = hash;
        d.title = meta.optString("title", hash);
        d.year = meta.optInt("year", 0);
        d.quality = meta.optString("quality", "");
        JSONObject series = meta.optJSONObject("series");
        if (series != null) {
            d.showTitle = series.optString("showTitle");
            d.season = series.optInt("season");
            d.episode = series.optInt("episode");
        }
        d.stagingDir = stagingDirFor(hash);
        downloads.put(hash, d);
        DownloadService.sync(app, activeDownloads());

        // Metadata can take a while: do it off the caller's thread
        new Thread(() -> {
            try {
                TorrentInfo ti = fetchInfo(magnet, 120);
                awaitTempTorrentGone(ti);
                int best = bestVideoFile(ti);
                if (best < 0) throw new IOException("No video file found in this torrent.");
                //noinspection ResultOfMethodCallIgnored
                d.stagingDir.mkdirs();
                sm.download(ti, d.stagingDir, null, onlyFile(ti.numFiles(), best), peerHints(magnet), TorrentFlags.AUTO_MANAGED);
                d.hints = peerHints(magnet);
                d.th = awaitHandle(ti);
                d.ti = ti;
                d.fileIndex = best;
                d.size = ti.files().fileSize(best);
                d.status = "downloading";
            } catch (Exception e) {
                d.status = "error";
                d.error = e.getMessage() == null ? "Download failed" : e.getMessage();
                deleteRecursive(d.stagingDir);
            }
        }, "dl-start-" + hash.substring(0, 6)).start();

        return toJson(d);
    }

    private int activeDownloads() {
        int n = 0;
        for (Download d : downloads.values()) {
            if ("metadata".equals(d.status) || "downloading".equals(d.status) || "finalizing".equals(d.status)) n++;
        }
        return n;
    }

    private void tick() {
        try {
            for (final Download d : downloads.values()) {
                if (d.th == null || d.ti == null) continue;
                if (!("downloading".equals(d.status) || "paused".equals(d.status))) continue;
                try {
                    if (!d.th.isValid()) continue;
                    TorrentStatus st = d.th.status();
                    long[] fp = d.th.fileProgress();
                    d.downloaded = d.fileIndex < fp.length ? fp[d.fileIndex] : 0;
                    d.progress = d.size > 0 ? Math.min(1.0, (double) d.downloaded / d.size) : 0;
                    d.speed = d.paused ? 0 : st.downloadRate();
                    d.peers = st.numPeers();
                    if (!d.paused && (d.downloaded >= d.size || st.isFinished())) {
                        d.status = "finalizing";
                        new Thread(() -> finalizeDownload(d), "dl-final-" + d.hash.substring(0, 6)).start();
                    }
                } catch (Exception ignored) {
                    // this download is being removed; the others keep going
                }
            }
            int active = activeDownloads();
            if (active != lastServiceCount) {
                lastServiceCount = active;
                DownloadService.sync(app, active);
            }
        } catch (Exception ignored) {
            // keep ticking
        }
    }

    private void finalizeDownload(Download d) {
        try {
            // Leave the player alone if the user is still watching this one
            while (sHandle == d.th && sHandle != null) Thread.sleep(2000);
            File source = new File(d.stagingDir, d.ti.files().filePath(d.fileIndex));
            try { sm.remove(d.th); } catch (Exception ignored) { /* already removed */ }
            Thread.sleep(300);

            String ext = d.ti.files().fileName(d.fileIndex);
            ext = ext.contains(".") ? ext.substring(ext.lastIndexOf('.')) : ".mp4";
            String sub, name;
            if (d.showTitle != null && !d.showTitle.isEmpty()) {
                String show = safe(d.showTitle);
                String ep = String.format(Locale.US, "S%02dE%02d", d.season, d.episode);
                sub = show + "/Season " + String.format(Locale.US, "%02d", d.season);
                name = show + " - " + ep + " [" + d.quality + "]" + ext;
            } else {
                String base = safe(d.title) + (d.year > 0 ? " (" + d.year + ")" : "");
                sub = base;
                name = base + " [" + d.quality + "]" + ext;
            }
            d.savedPath = Library.publish(app, source, sub, name);
            deleteRecursive(d.stagingDir);
            d.status = "done";
            d.progress = 1;
            d.speed = 0;
            FinishedListener l = finishedListener;
            if (l != null) l.onFinished(toJson(d));
        } catch (Exception e) {
            d.status = "error";
            d.error = e.getMessage() == null ? "Could not save the download" : e.getMessage();
        }
    }

    private static String safe(String s) {
        return s.replaceAll("[<>:\"/\\\\|?*\\x00-\\x1f]", "").replaceAll("\\s+", " ").trim().replaceAll("[. ]+$", "");
    }

    public JSONObject toJson(Download d) throws JSONException {
        JSONObject o = new JSONObject();
        o.put("infoHash", d.hash);
        o.put("title", d.title);
        o.put("year", d.year);
        o.put("quality", d.quality);
        o.put("status", d.status);
        o.put("progress", d.progress);
        o.put("downloadSpeed", d.speed);
        o.put("peers", d.peers);
        o.put("downloaded", d.downloaded);
        o.put("size", d.size);
        if (d.error != null) o.put("error", d.error);
        if (d.savedPath != null) o.put("savedPath", d.savedPath);
        return o;
    }

    public List<JSONObject> listDownloads() throws JSONException {
        List<JSONObject> out = new ArrayList<>();
        for (Download d : downloads.values()) out.add(toJson(d));
        return out;
    }

    public void cancelDownload(String hash) {
        Download d = downloads.remove(hash);
        if (d == null) return;
        if ("done".equals(d.status)) return;
        if (d.th != null) {
            if (sHandle == d.th) stopStream();
            try { sm.remove(d.th, SessionHandle.DELETE_FILES); } catch (Exception ignored) { /* gone */ }
        }
        deleteRecursive(d.stagingDir);
    }

    public void pauseDownload(String hash) {
        Download d = downloads.get(hash);
        if (d != null && d.th != null && "downloading".equals(d.status)) { d.th.pause(); d.paused = true; d.status = "paused"; }
    }

    public void resumeDownload(String hash) {
        Download d = downloads.get(hash);
        if (d != null && d.th != null && "paused".equals(d.status)) {
            d.th.resume();
            d.paused = false;
            d.status = "downloading";
            // Pausing drops every connection: ask trackers/DHT again and reconnect to the peers named in the magnet link
            try { d.th.forceReannounce(); d.th.forceDHTAnnounce(); } catch (Exception ignored) { /* best effort */ }
            if (d.hints != null) for (TcpEndpoint ep : d.hints) {
                try { d.th.swig().connect_peer(ep.swig()); } catch (Throwable ignored) { /* best effort */ }
            }
        }
    }

    public void clearFinished() {
        for (Map.Entry<String, Download> e : downloads.entrySet()) {
            String s = e.getValue().status;
            if ("done".equals(s) || "error".equals(s)) downloads.remove(e.getKey());
        }
    }

    /** Called when the app is closed for good: unfinished downloads are cancelled like on desktop. */
    public void shutdown() {
        for (String h : new ArrayList<>(downloads.keySet())) cancelDownload(h);
        stopStream();
    }
}
