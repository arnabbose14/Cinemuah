const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, assert, assertEq, sleep, adb, sh, startSeeder, ffmpeg, PROJ, PKG } = require('../lib');
const G = 'streaming';
const FIX = path.join(PROJ, 'tests', 'fixtures');

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 200000, ...o });
  const seeders = [];
  const cleanup = () => { while (seeders.length) seeders.pop().stop(); };

  function fixture(name, make) {
    fs.mkdirSync(FIX, { recursive: true });
    const f = path.join(FIX, name);
    if (!fs.existsSync(f)) make(f);
    return f;
  }
  const smallMovie = () => fixture('stream-small.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=45:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=45', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '30', '-g', '24', '-c:a', 'aac', '-movflags', '+faststart', f]));
  const bigMovie = () => fixture('stream-big.mp4', f => ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=duration=60:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '8M', '-g', '48', '-c:a', 'aac', '-movflags', '+faststart', f]));
  const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');

  const streamFiles = () => sh(`ls /sdcard/Android/data/${PKG}/files/stream 2>/dev/null | wc -l`).trim();

  async function startLocal(seeder) {
    const info = await d().ev(`window.electronAPI.torrent.start(${JSON.stringify(seeder.magnet)})`);
    const port = await d().ev('window.electronAPI.media.getPort()');
    return { info, base: `http://127.0.0.1:${port}${info.streamPath}` };
  }
  const rangeFetch = (url, range, method = 'GET') => `(async () => {
    const r = await fetch(${JSON.stringify(url)}, { method: ${JSON.stringify(method)}, headers: ${range ? `{ Range: ${JSON.stringify(range)} }` : '{}'} });
    const buf = ${JSON.stringify(method)} === 'HEAD' ? new ArrayBuffer(0) : await r.arrayBuffer();
    let bin = ''; const u = new Uint8Array(buf.slice(0, 4096)); for (const b of u) bin += String.fromCharCode(b);
    return { status: r.status, len: buf.byteLength, cl: r.headers.get('content-length'), cr: r.headers.get('content-range'), ar: r.headers.get('accept-ranges'), head: btoa(bin) }; })()`;

  t('local torrent: whole stream is byte-identical to the source (SHA-1)', async () => {
    await d().ensure();
    const file = smallMovie(); const want = sha1(fs.readFileSync(file));
    const s = await startSeeder(file, { port: 6991 }); seeders.push(s);
    const { base, info } = await startLocal(s);
    assertEq(info.fileSize, fs.statSync(file).size, 'fileSize reported');
    const got = await d().ev(`(async () => { const r = await fetch(${JSON.stringify(base)}); const buf = await r.arrayBuffer(); const h = await crypto.subtle.digest('SHA-1', buf); return { status: r.status, len: buf.byteLength, hex: [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('') }; })()`);
    assertEq(got.status, 200); assertEq(got.len, fs.statSync(file).size, 'bytes received'); assertEq(got.hex, want, 'SHA-1 of the streamed file');
    await d().ev('window.electronAPI.torrent.stop()');
  });

  t('local torrent: Range requests (first bytes, suffix, middle, open-ended, 416, HEAD) return correct bytes', async () => {
    await d().ensure();
    const file = smallMovie(); const data = fs.readFileSync(file); const size = data.length;
    const s = await startSeeder(file, { port: 6992 }); seeders.push(s);
    const { base } = await startLocal(s);
    const check = async (range, from, to, label) => {
      const r = await d().ev(rangeFetch(base, range));
      assertEq(r.status, 206, label + ' status'); assertEq(r.len, to - from + 1, label + ' length');
      assertEq(r.cr, `bytes ${from}-${to}/${size}`, label + ' Content-Range'); assertEq(r.ar, 'bytes', label + ' Accept-Ranges');
      assertEq(Buffer.from(r.head, 'base64').toString('hex'), data.subarray(from, Math.min(from + 4096, to + 1)).toString('hex'), label + ' bytes');
    };
    await check('bytes=0-99', 0, 99, 'first 100');
    await check('bytes=-50', size - 50, size - 1, 'suffix 50');
    await check(`bytes=${size - 10}-`, size - 10, size - 1, 'open-ended tail');
    const mid = Math.floor(size / 2);
    await check(`bytes=${mid}-${mid + 99999}`, mid, mid + 99999, 'middle 100KB');
    const past = await d().ev(rangeFetch(base, `bytes=${size + 5}-`)); assertEq(past.status, 416, 'range past the end');
    const head = await d().ev(rangeFetch(base, null, 'HEAD')); assertEq(head.status, 200, 'HEAD'); assertEq(head.cl, String(size), 'HEAD length');
    await d().ev('window.electronAPI.torrent.stop()');
  });

  t('seeking: a far-away range is prioritised, not waited for sequentially (throttled seeder)', async () => {
    await d().ensure();
    const file = bigMovie(); const data = fs.readFileSync(file); const size = data.length;
    assert(size > 25 * 1024 * 1024, 'fixture too small for a seek test: ' + size);
    const s = await startSeeder(file, { port: 6993, uploadLimit: 700 * 1024 }); seeders.push(s);
    const { base } = await startLocal(s);
    const from = Math.floor(size * 0.8);
    const t0 = Date.now();
    const r = await d().ev(rangeFetch(base, `bytes=${from}-${from + 65535}`));
    const secs = (Date.now() - t0) / 1000;
    assertEq(r.status, 206, 'status'); assertEq(Buffer.from(r.head, 'base64').toString('hex'), data.subarray(from, from + 4096).toString('hex'), 'bytes at 80%');
    const sequentialEstimate = (size * 0.8) / (700 * 1024);
    assert(secs < sequentialEstimate / 3, `seek took ${secs.toFixed(1)}s (a sequential wait would be ~${sequentialEstimate.toFixed(0)}s)`);
    await d().ev('window.electronAPI.torrent.stop()');
  }, { timeout: 240000 });

  t('connecting to a dead torrent does not freeze the other native calls', async () => {
    await d().ensure();
    await d().ev(`window.__dead = window.electronAPI.torrent.start('magnet:?xt=urn:btih:${'ab'.repeat(20)}').then(() => 'started', e => 'rejected: ' + (e.message || e)); 1`);
    await sleep(1500);
    const times = await d().ev(`(async () => { const out = []; for (let i = 0; i < 6; i++) { const t0 = performance.now(); await window.electronAPI.torrent.stats(); await window.electronAPI.downloads.list(); await window.electronAPI.media.getPort(); out.push(Math.round(performance.now() - t0)); await new Promise(r => setTimeout(r, 500)); } return out; })()`);
    assert(Math.max(...times) < 1500, 'native calls stalled while connecting: ' + times.join(', ') + ' ms');
    await d().ev('window.electronAPI.torrent.stop()');
    const outcome = await d().waitFor(`window.__dead.then(v => v)`, { timeout: 70000, message: 'dead start to settle' });
    assert(/rejected/.test(outcome), 'dead torrent start should fail, got ' + outcome);
  }, { timeout: 150000 });

  t('stopping a stream removes its cache from the phone', async () => {
    await d().ensure();
    const file = smallMovie();
    const s = await startSeeder(file, { port: 6994 }); seeders.push(s);
    await startLocal(s);
    await d().waitFor(`true`, { timeout: 1000 });
    const t0 = Date.now(); while (Number(streamFiles()) < 1 && Date.now() - t0 < 30000) await sleep(1000);   // peers connect after ~8s
    assert(Number(streamFiles()) >= 1, 'no stream cache created');
    await d().ev('window.electronAPI.torrent.stop()'); await sleep(2500);
    assertEq(streamFiles(), '0', 'stream cache left behind');
  });

  // â”€â”€ real swarms â”€â”€
  async function playFromDialog(openDialog, label) {
    await d().cleanSlate();
    await d().ev(`document.querySelector('.movie-detail-overlay')?.click()`);
    await d().setMode('online'); await d().nav('Home');
    await d().waitFor(`[...document.querySelectorAll('.section-title')].map(e => e.textContent).includes('Top Rated')`, { timeout: 45000 });
    await sleep(1000);
    await openDialog();
  }
  const playerState = `(() => { const v = document.querySelector('video'); return v ? { t: +v.currentTime.toFixed(1), dur: v.duration, w: v.videoWidth, paused: v.paused, ready: v.readyState, err: v.error && v.error.code, buffered: v.buffered.length ? +v.buffered.end(v.buffered.length - 1).toFixed(0) : 0 } : null; })()`;

  t('Online movie: Stream (default pick) plays; pause/resume, skip, seek, landscape, Back cleans up', async () => {
    await playFromDialog(async () => {
      await d().ev(`[...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title').textContent === 'Most Downloaded').querySelector('.movie-card').click()`);
      await d().waitFor(`!!document.querySelector('input[name=torrent]:checked')`);
    });
    // The emulator's NAT'd network sustains ~150KB/s, too slow to start 1080p quickly: use the 720p row when there is one
    await d().ev(`(() => { const r = [...document.querySelectorAll('input[name=torrent]')].find(i => i.closest('label').innerText.trim().startsWith('720p')); if (r) r.click(); })()`);
    await sleep(300);
    const chosen = await d().ev(`document.querySelector('input[name=torrent]:checked').closest('label').innerText.replace(/\\s+/g, ' ').trim()`);
    await d().ev(`(() => { const o = window.electronAPI.torrent.start; window.electronAPI.torrent.start = async m => { const t0 = performance.now(); try { return await o(m); } finally { window.__metaMs = Math.round(performance.now() - t0); } }; })()`);
    const t0 = Date.now();
    await d().tap('.detail-content .btn-primary');
    await d().waitFor(`!!document.querySelector('.player-overlay')`, { timeout: 8000, message: 'player overlay' });
    const first = await d().waitFor(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 3 && v.currentTime > 1.5 && v.videoWidth > 0 ? ${playerState} : null; })()`, { timeout: 200000, message: 'playback to start' });
    const startSecs = ((Date.now() - t0) / 1000).toFixed(1);
    const metaMs = await d().ev('window.__metaMs');
    console.log(`        (${chosen}: playing after ${startSecs}s = ${(metaMs / 1000).toFixed(1)}s finding peers + metadata, ${(startSecs - metaMs / 1000).toFixed(1)}s buffering; ${first.w}px wide)`);
    assert(!first.err, 'video error ' + first.err);
    // landscape + immersive while the player is up
    assert(await d().ev('innerWidth > innerHeight'), 'player did not switch to landscape');
    await d().shot('player-landscape');
    // pause / resume through the on-screen button
    await d().ev(`document.querySelector('.player-controls-overlay')?.classList.add('visible')`);
    await d().tap('button[title="Play/Pause (Space)"]'); await sleep(700);
    assert((await d().ev(playerState)).paused, 'did not pause');
    await d().tap('button[title="Play/Pause (Space)"]'); await sleep(1500);
    const resumed = await d().ev(playerState); assert(!resumed.paused, 'did not resume');
    // skip forward 10s
    const before = (await d().ev(playerState)).t;
    await d().tap('button[title^="Skip forward"]'); await sleep(2500);
    const afterSkip = (await d().ev(playerState)).t; assert(afterSkip >= before + 8, `skip +10s moved ${before} -> ${afterSkip}`);
    // seek far ahead inside the torrent
    const dur = (await d().ev(playerState)).dur;
    if (Number.isFinite(dur) && dur > 120) {
      await d().ev(`document.querySelector('video').currentTime = ${Math.floor(dur * 0.55)}`);
      const sought = await d().waitFor(`(() => { const s = ${playerState}; return s && Math.abs(s.t - ${Math.floor(dur * 0.55)}) < 20 && !s.paused && s.ready >= 3 && s.t > ${Math.floor(dur * 0.55)} + 1 ? s : null; })()`, { timeout: 90000, message: 'playback after seeking to 55%' });
      assert(!sought.err, 'error after seek');
    }
    // Back closes the player, restores portrait, stops the torrent
    await d().back(); await sleep(1500);
    assert(!(await d().exists('.player-overlay')), 'player still open after Back');
    assert(await d().ev('innerHeight > innerWidth'), 'portrait not restored');
    await sleep(2000);
    assertEq(await d().ev(`window.electronAPI.torrent.stats().then(s => s === null)`), true, 'torrent still active after closing');
    assertEq(streamFiles(), '0', 'stream cache left behind');
  }, { timeout: 420000 });

  t('series episode: Play streams a 1080p/720p episode', async () => {
    await playFromDialog(async () => {
      await d().ev(`[...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title').textContent === 'Popular Series').querySelector('.movie-card').click()`);
      await d().waitFor(`document.querySelectorAll('.movie-detail .btn-primary').length > 0`, { timeout: 45000, message: 'episodes' });
    });
    const label = await d().ev(`document.querySelector('.movie-detail .btn-primary').closest('div[style*="gap: 14px"]')?.innerText.replace(/\\s+/g, ' ').slice(0, 90)`);
    const t0 = Date.now();
    await d().tap('.movie-detail .btn-primary');
    const st = await d().waitFor(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 3 && v.currentTime > 1.5 && v.videoWidth > 0 ? ${playerState} : null; })()`, { timeout: 180000, message: 'episode playback' });
    console.log(`        (${label} -> playing in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${st.w}px)`);
    assert(!st.err, 'video error ' + st.err);
    await d().back(); await sleep(2000);
    assert(!(await d().exists('.player-overlay')), 'player still open');
  }, { timeout: 300000 });

  t('Back while still connecting cancels cleanly; the next stream still works', async () => {
    await playFromDialog(async () => {
      await d().ev(`[...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title').textContent === 'New Releases').querySelector('.movie-card').click()`);
      await d().waitFor(`!!document.querySelector('input[name=torrent]:checked')`);
    });
    await d().tap('.detail-content .btn-primary');
    await d().waitFor(`!!document.querySelector('.player-overlay')`, { timeout: 8000 });
    await sleep(800);
    await d().back(); await sleep(1500);
    assert(!(await d().exists('.player-overlay')), 'player still open after Back');
    assert(await d().ev('innerHeight > innerWidth'), 'portrait not restored');
    // start another one straight away
    await d().ev(`[...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title').textContent === 'Most Downloaded').querySelector('.movie-card').click()`);
    await d().waitFor(`!!document.querySelector('input[name=torrent]:checked')`);
    await d().tap('.detail-content .btn-primary');
    const st = await d().waitFor(`(() => { const v = document.querySelector('video'); return v && v.readyState >= 3 && v.currentTime > 1 && v.videoWidth > 0 ? ${playerState} : null; })()`, { timeout: 160000, message: 'second stream to play' });
    assert(!st.err, 'error on the second stream');
    await d().back(); await sleep(1500);
    assertEq(d().fatals(), '', 'native crash');
  }, { timeout: 360000 });

  t('(cleanup) stop local seeders', async () => { cleanup(); });
};
