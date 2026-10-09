const fs = require('fs');
const p = process.argv[2];
let t = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); t = t.replace(a, b); };

rep("    private static void deleteRecursive(File f) {",
`    /**
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

    private static void deleteRecursive(File f) {`);

// stream: after fetching metadata, before adding the real torrent
rep("            info = fetchInfo(magnet, 45);                       // slow: no lock held\n            file = bestVideoFile(info);",
    "            info = fetchInfo(magnet, 45);                       // slow: no lock held\n            awaitTempTorrentGone(info);\n            file = bestVideoFile(info);");
// download
rep("                TorrentInfo ti = fetchInfo(magnet, 120);\n                int best = bestVideoFile(ti);",
    "                TorrentInfo ti = fetchInfo(magnet, 120);\n                awaitTempTorrentGone(ti);\n                int best = bestVideoFile(ti);");
fs.writeFileSync(p, t);
console.log('engine patched');
