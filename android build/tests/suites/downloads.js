const fs = require('fs');
const path = require('path');
const { test, assert, assertEq, sleep, adb, sh, startSeeder, ffmpeg, PROJ, PKG } = require('../lib');
const G = 'downloads';
const FIX = path.join(PROJ, 'tests', 'fixtures');

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 150000, ...o });
  const seeders = [];

  function fixture(name, make) {
    fs.mkdirSync(FIX, { recursive: true });
    const f = path.join(FIX, name);
    if (!fs.existsSync(f)) make(f);
    return f;
  }
  const movieFile = () => fixture('Test.Movie.2024.720p.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=45:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=45', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '30', '-g', '24', '-c:a', 'aac', '-movflags', '+faststart', f]));
  const episodeFile = () => fixture('Test.Show.S01E02.720p.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=duration=30:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=520:duration=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '30', '-g', '24', '-c:a', 'aac', '-movflags', '+faststart', f]));
  const bigFile = () => fixture('stream-big.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=duration=60:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '8M', '-g', '48', '-c:a', 'aac', '-movflags', '+faststart', f]));

  const mediaRows = () => sh(`content query --uri content://media/external/video/media --projection _display_name:relative_path:_size --where "relative_path LIKE 'Movies/Cinemuah%'"`);
  const stagingCount = () => sh(`ls /sdcard/Android/data/${PKG}/files/downloads 2>/dev/null | wc -l`).trim();
  const services = () => sh(`dumpsys activity services ${PKG}`);
  const list = () => d().ev('window.electronAPI.downloads.list()');
  const find = async hash => (await list()).find(x => x.infoHash === hash);
  async function waitStatus(hash, status, timeout = 90000) {
    const deadline = Date.now() + timeout; let last;
    while (Date.now() < deadline) { last = await find(hash); if (last && last.status === status) return last; if (last && last.status === 'error') throw new Error('download errored: ' + last.error); await sleep(700); }
    throw new Error(`timed out waiting for "${status}" (last: ${last && last.status} ${last && Math.round(last.progress * 100)}%)`);
  }
  async function waitProgress(hash, above, timeout = 40000) {
    const deadline = Date.now() + timeout; let x;
    while (Date.now() < deadline) { x = await find(hash); if (x && x.progress > above && x.downloadSpeed > 0) return x; await sleep(700); }
    throw new Error('no progress above ' + above + ' within ' + timeout / 1000 + 's (last: ' + JSON.stringify(x && { s: x.status, p: x.progress, v: x.downloadSpeed, peers: x.peers }) + ')');
  }
  const start = (s, meta) => d().ev(`window.electronAPI.downloads.start(${JSON.stringify(s.magnet)}, ${JSON.stringify(meta)})`);

  t('movie download finishes into Movies/Cinemuah/<Title (Year)>/ and shows up in the library', async () => {
    await d().ensure();
    await d().ev(`window.electronAPI.downloads.clear(); window.__fin = []; window.__off && window.__off(); window.__off = window.electronAPI.downloads.onFinished(i => window.__fin.push(i.title)); 1`);
    const file = movieFile(); const s = await startSeeder(file, { port: 6995 }); seeders.push(s);
    const first = await start(s, { title: 'Test Movie', year: 2024, quality: '720p' });
    assertEq(first.infoHash, s.hash, 'infoHash'); assert(['metadata', 'downloading'].includes(first.status), 'initial status ' + first.status);
    const done = await waitStatus(s.hash, 'done');
    assert(/Movies\/Cinemuah\/Test Movie \(2024\)\/Test Movie \(2024\) \[720p\]\.mp4$/.test(done.savedPath), 'savedPath ' + done.savedPath);
    const rows = mediaRows(); assert(rows.includes('Test Movie (2024) [720p].mp4') && rows.includes(`_size=${fs.statSync(file).size}`), 'MediaStore row missing or wrong size:\n' + rows);
    await sleep(1500);
    assertEq(stagingCount(), '0', 'staging folder not cleaned');
    assert((await d().ev('window.__fin')).includes('Test Movie'), 'downloadFinished event not delivered to the UI');
    const lib = await d().ev('window.electronAPI.library.scan().then(() => window.electronAPI.movies.getAll())');
    assert(lib.some(m => m.fileName === 'Test Movie (2024) [720p].mp4' && m.title === 'Test Movie' && m.year === 2024), 'library entry not parsed: ' + JSON.stringify(lib.map(m => [m.title, m.year])));
  });

  t('series episode is saved as Show/Season 01/Show - S01E02 [quality]', async () => {
    await d().ensure();
    const s = await startSeeder(episodeFile(), { port: 6996 }); seeders.push(s);
    await start(s, { title: 'Test Show S01E02', year: 2023, quality: '720p', series: { showTitle: 'Test Show', season: 1, episode: 2 } });
    const done = await waitStatus(s.hash, 'done');
    assert(/Movies\/Cinemuah\/Test Show\/Season 01\/Test Show - S01E02 \[720p\]\.mp4$/.test(done.savedPath), 'savedPath ' + done.savedPath);
    assert(mediaRows().includes('relative_path=Movies/Cinemuah/Test Show/Season 01/'), 'MediaStore path wrong:\n' + mediaRows());
  });

  t('duplicate start returns the same item; a bad magnet is rejected with a message', async () => {
    await d().ensure();
    const s = await startSeeder(movieFile(), { port: 6997 }); seeders.push(s);
    const bigS = await startSeeder(bigFile(), { port: 6998, uploadLimit: 400 * 1024 }); seeders.push(bigS);
    await start(bigS, { title: 'Dup Test', year: 2020, quality: '1080p' });
    await start(bigS, { title: 'Dup Test', year: 2020, quality: '1080p' });
    const copies = (await list()).filter(x => x.infoHash === bigS.hash).length;
    assertEq(copies, 1, 'duplicate entries for one torrent');
    const err = await d().ev(`window.electronAPI.downloads.start('https://example.com/not-a-magnet', { title: 'x', year: 1, quality: '720p' }).then(() => 'accepted', e => String(e.message || e))`);
    assert(err !== 'accepted' && /magnet/i.test(err), 'bad magnet result: ' + err);
    await d().ev(`window.electronAPI.downloads.cancel(${JSON.stringify(bigS.hash)})`);
  });

  t('throttled download: progress, speed, Pause / Resume / Cancel from the Downloads page, service + cleanup', async () => {
    await d().ensure();
    await d().ev(`window.electronAPI.downloads.clear(); 1`);
    const s = await startSeeder(bigFile(), { port: 6999, uploadLimit: 500 * 1024 }); seeders.push(s);
    await start(s, { title: 'Big Download', year: 2022, quality: '1080p' });
    await d().setMode('online'); await d().nav('Home');
    await d().tap('button[title="Downloads"]');
    await d().waitFor(`/Big Download/.test(document.querySelector('.main-content').innerText)`, { message: 'row on the Downloads page' });
    await waitStatus(s.hash, 'downloading', 60000);
    const a = await waitProgress(s.hash, 0, 60000);
    assert(a.progress > 0 && a.downloadSpeed > 50 * 1024 && a.peers >= 1, `no real progress: ${JSON.stringify({ p: a.progress, v: a.downloadSpeed, peers: a.peers })}`);
    assert(/DownloadService/.test(services()), 'foreground download service not running');
    assert(await d().ev(`/\\d+%/.test(document.querySelector('.main-content').innerText)`), 'page shows no percentage');
    await d().shot('downloads-active');
    // pause
    await d().tap('button[title="Pause"]'); await sleep(1500);
    const p1 = (await find(s.hash)); assertEq(p1.status, 'paused', 'status after Pause');
    await sleep(4000);
    const p2 = (await find(s.hash)); assert(Math.abs(p2.progress - p1.progress) < 0.01, `kept downloading while paused (${p1.progress} -> ${p2.progress})`);
    // resume
    await d().tap('button[title="Resume"]'); await sleep(1500);
    assertEq((await find(s.hash)).status, 'downloading', 'status after Resume');
    await waitProgress(s.hash, p2.progress, 40000);   // peers reconnect first, so allow ~10s
    // cancel
    await d().tap('button[title^="Cancel"]'); await sleep(2500);
    assert(!(await find(s.hash)), 'still listed after Cancel');
    assertEq(stagingCount(), '0', 'partial file not deleted');
    await sleep(3000);
    assert(!/DownloadService/.test(services()), 'service still running with nothing to download');
    assert(!mediaRows().includes('Big Download'), 'cancelled download leaked into the library');
  }, { timeout: 200000 });

  t('downloads keep running with the app in the background', async () => {
    await d().ensure();
    const s = await startSeeder(bigFile(), { port: 6990, uploadLimit: 500 * 1024 }); seeders.push(s);
    await start(s, { title: 'Background Test', year: 2021, quality: '1080p' });
    await waitStatus(s.hash, 'downloading', 60000);
    const before = (await waitProgress(s.hash, 0, 60000)).progress;
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(14000);
    assert(sh(`pidof ${PKG}`), 'app process was killed in the background');
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(2500);
    const after = (await find(s.hash)).progress;
    assert(after > before, `no progress in the background (${before} -> ${after})`);
    await d().ev(`window.electronAPI.downloads.cancel(${JSON.stringify(s.hash)})`); await sleep(1500);
  }, { timeout: 150000 });

  t('streaming a torrent that is already downloading shares it and does not cancel the download', async () => {
    await d().ensure();
    const s = await startSeeder(bigFile(), { port: 6989, uploadLimit: 600 * 1024 }); seeders.push(s);
    await start(s, { title: 'Shared Stream', year: 2020, quality: '1080p' });
    await waitStatus(s.hash, 'downloading', 60000);
    const info = await d().ev(`window.electronAPI.torrent.start(${JSON.stringify(s.magnet)})`);
    const port = await d().ev('window.electronAPI.media.getPort()');
    const r = await d().ev(`(async () => { const r = await fetch('http://127.0.0.1:${port}${info.streamPath}', { headers: { Range: 'bytes=0-999' } }); return { status: r.status, len: (await r.arrayBuffer()).byteLength }; })()`);
    assertEq(r.status, 206); assertEq(r.len, 1000);
    await d().ev('window.electronAPI.torrent.stop()'); await sleep(1500);
    const stillThere = await find(s.hash);
    assert(stillThere && ['downloading', 'metadata'].includes(stillThere.status), 'stopping the stream killed the download: ' + JSON.stringify(stillThere));
    await d().ev(`window.electronAPI.downloads.cancel(${JSON.stringify(s.hash)})`);
  }, { timeout: 150000 });

  t('"Clear finished" removes done entries from the Downloads page', async () => {
    await d().ensure(); await d().nav('Home');
    const cs = await startSeeder(movieFile(), { port: 6984 }); seeders.push(cs);
    await start(cs, { title: 'Test Movie', year: 2024, quality: '720p' }); await waitStatus(cs.hash, 'done');
    await d().tap('button[title="Downloads"]'); await sleep(1500);
    assert(await d().ev(`/Test Movie/.test(document.querySelector('.main-content').innerText)`), 'finished movie not listed');
    await d().clickText('button', 'Clear finished'); await sleep(1500);
    assert(!(await d().ev(`/Test Movie/.test(document.querySelector('.main-content').innerText)`)), 'still listed after Clear finished');
    await d().tap('.navbar-logo');
  });

  t('(cleanup) stop local seeders', async () => { while (seeders.length) seeders.pop().stop(); });
};
