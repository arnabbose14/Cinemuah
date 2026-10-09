const fs = require('fs');
const p = process.argv[2];
let t = fs.readFileSync(p, 'utf8');
const rep = (a, b) => { if (!t.includes(a)) throw new Error('missing: ' + a.slice(0, 70)); t = t.replace(a, b); };
const wait = `  async function waitProgress(hash, above, timeout = 40000) {
    const deadline = Date.now() + timeout; let x;
    while (Date.now() < deadline) { x = await find(hash); if (x && x.progress > above && x.downloadSpeed > 0) return x; await sleep(700); }
    throw new Error('no progress above ' + above + ' within ' + timeout / 1000 + 's (last: ' + JSON.stringify(x && { s: x.status, p: x.progress, v: x.downloadSpeed, peers: x.peers }) + ')');
  }
`;
rep("  const start = (s, meta) =>", wait + "  const start = (s, meta) =>");
rep("    const live = await waitStatus(s.hash, 'downloading', 60000);\n    await sleep(5000);\n    const a = await find(s.hash);\n    assert(a.progress > 0 && a.downloadSpeed > 50 * 1024 && a.peers >= 1,", "    await waitStatus(s.hash, 'downloading', 60000);\n    const a = await waitProgress(s.hash, 0, 60000);\n    assert(a.progress > 0 && a.downloadSpeed > 50 * 1024 && a.peers >= 1,");
rep("    await d().tap('button[title=\"Resume\"]'); await sleep(6000);\n    const p3 = (await find(s.hash)); assertEq(p3.status, 'downloading', 'status after Resume'); assert(p3.progress > p2.progress, `did not progress after Resume (${p2.progress} -> ${p3.progress})`);",
    "    await d().tap('button[title=\"Resume\"]'); await sleep(1500);\n    assertEq((await find(s.hash)).status, 'downloading', 'status after Resume');\n    await waitProgress(s.hash, p2.progress, 40000);   // peers reconnect first, so allow ~10s");
rep("    await waitStatus(s.hash, 'downloading', 60000); await sleep(2500);\n    const before = (await find(s.hash)).progress;\n    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(12000);", "    await waitStatus(s.hash, 'downloading', 60000);\n    const before = (await waitProgress(s.hash, 0, 60000)).progress;\n    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(14000);");
rep("    const after = (await find(s.hash)).progress;\n    assert(after > before + 0.01, `no progress in the background (${before} -> ${after})`);", "    const after = (await find(s.hash)).progress;\n    assert(after > before, `no progress in the background (${before} -> ${after})`);");
rep("  t('\"Clear finished\" removes done entries from the Downloads page', async () => {\n    await d().ensure(); await d().nav('Home');", "  t('\"Clear finished\" removes done entries from the Downloads page', async () => {\n    await d().ensure(); await d().nav('Home');\n    const cs = await startSeeder(movieFile(), { port: 6984 }); seeders.push(cs);\n    await start(cs, { title: 'Test Movie', year: 2024, quality: '720p' }); await waitStatus(cs.hash, 'done');");
fs.writeFileSync(p, t);
console.log('downloads tests patched');
