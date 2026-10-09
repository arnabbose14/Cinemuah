const fs = require('fs');
const p = process.argv[2];
let t = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); t = t.replace(a, b); };
rep("    const t0 = Date.now();\n    await d().tap('.detail-content .btn-primary');\n    await d().waitFor(`!!document.querySelector('.player-overlay')`, { timeout: 8000, message: 'player overlay' });\n    const first",
    "    await d().ev(`(() => { const o = window.electronAPI.torrent.start; window.electronAPI.torrent.start = async m => { const t0 = performance.now(); try { return await o(m); } finally { window.__metaMs = Math.round(performance.now() - t0); } }; })()`);\n    const t0 = Date.now();\n    await d().tap('.detail-content .btn-primary');\n    await d().waitFor(`!!document.querySelector('.player-overlay')`, { timeout: 8000, message: 'player overlay' });\n    const first");
rep("    console.log(`        (${chosen} started in ${startSecs}s, ${first.w}px wide)`);",
    "    const metaMs = await d().ev('window.__metaMs');\n    console.log(`        (${chosen}: playing after ${startSecs}s = ${(metaMs / 1000).toFixed(1)}s finding peers + metadata, ${(startSecs - metaMs / 1000).toFixed(1)}s buffering; ${first.w}px wide)`);");
fs.writeFileSync(p, t);
console.log('patched');
