const fs = require('fs');
const p = process.argv[2];
let t = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); t = t.replace(a, b); };
rep("        boolean paused;\n    }", "        boolean paused;\n        List<TcpEndpoint> hints;   // direct peer hints from the magnet link, re-used when resuming\n    }");
rep("                d.th = awaitHandle(ti);\n                d.ti = ti;", "                d.hints = peerHints(magnet);\n                d.th = awaitHandle(ti);\n                d.ti = ti;");
rep(`if (d != null && d.th != null && "paused".equals(d.status)) { d.th.resume(); d.paused = false; d.status = "downloading"; }`,
`if (d != null && d.th != null && "paused".equals(d.status)) {
            d.th.resume();
            d.paused = false;
            d.status = "downloading";
            // Pausing drops every connection: ask trackers/DHT again and reconnect to the peers named in the magnet link
            try { d.th.forceReannounce(); d.th.forceDHTAnnounce(); } catch (Exception ignored) { /* best effort */ }
            if (d.hints != null) for (TcpEndpoint ep : d.hints) {
                try { d.th.swig().connect_peer(ep.swig()); } catch (Throwable ignored) { /* best effort */ }
            }
        }`);
fs.writeFileSync(p, t);
console.log('resume patched');
