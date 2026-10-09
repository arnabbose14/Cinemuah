const fs = require('fs');
const root = process.argv[2];
let p = root + '/tests/lib.js', t = fs.readFileSync(p, 'utf8');
const old = "  async cleanSlate() {\n    await this.ensure();";
if (!t.includes(old)) throw new Error('cleanSlate not found');
t = t.replace(old, "  async cleanSlate() {\n    await this.ensure();\n    // a stalled stream or download from an earlier test would hog the emulator's bandwidth for every test after it\n    await this.ev(`window.electronAPI.torrent.stop().then(() => window.electronAPI.downloads.list()).then(l => Promise.all(l.map(x => window.electronAPI.downloads.cancel(x.infoHash))))`).catch(() => {});");
fs.writeFileSync(p, t);

p = root + '/tests/suites/streaming.js'; t = fs.readFileSync(p, 'utf8');
const a = "    const chosen = await d().ev(`document.querySelector('input[name=torrent]:checked').closest('label').innerText.replace(/\\\\s+/g, ' ').trim()`);";
if (!t.includes(a)) throw new Error('chosen line not found');
t = t.replace(a, "    // The emulator's NAT'd network sustains ~150KB/s, too slow to start 1080p quickly: use the 720p row when there is one\n    await d().ev(`(() => { const r = [...document.querySelectorAll('input[name=torrent]')].find(i => i.closest('label').innerText.trim().startsWith('720p')); if (r) r.click(); })()`);\n    await sleep(300);\n" + a);
t = t.replace("{ timeout: 150000, message: 'playback to start' }", "{ timeout: 200000, message: 'playback to start' }");
fs.writeFileSync(p, t);
console.log('patched');
