const fs = require('fs');
const p = process.argv[2] + '/android/app/src/main/java/com/cinemuah/app/TorrentEngine.java';
let t = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); t = t.replace(a, b); };
rep("    private int lastServiceCount = -1;", "    private int lastServiceCount = -1;\n    private volatile long lastRangeStart = -1;   // where the player last asked to read, to detect big seeks");
rep("        if (h == null) return null;\n        return new RangeStream(h, ti, new File(base, ti.files().filePath(fileIndex)), fileIndex, start);",
`        if (h == null) return null;
        // A big jump (a seek) leaves deadlines on pieces nobody needs any more; they would keep competing for bandwidth
        if (lastRangeStart >= 0 && Math.abs(start - lastRangeStart) > 8L * 1024 * 1024) {
            try { h.clearPieceDeadlines(); } catch (Exception ignored) { /* best effort */ }
        }
        lastRangeStart = start;
        return new RangeStream(h, ti, new File(base, ti.files().filePath(fileIndex)), fileIndex, start);`);
fs.writeFileSync(p, t);
console.log('seek deadline cleanup added');
