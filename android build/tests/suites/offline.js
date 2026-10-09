const fs = require('fs');
const path = require('path');
const { test, assert, assertEq, sleep, adb, sh, PROJ } = require('../lib');
const G = 'offline';
const FIX = path.join(PROJ, 'tests', 'fixtures');

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 120000, ...o });
  const movieFile = path.join(FIX, 'Test.Movie.2024.720p.mp4');

  async function offlineHome() {
    await d().ensure();
    await d().ev(`document.querySelector('.movie-detail-overlay')?.click()`);
    await d().setMode('offline'); await d().nav('Home');
    await d().ev('window.electronAPI.library.scan()');
    await sleep(1200);
  }
  const state = `(() => { const v = document.querySelector('video'); return v ? { t: +v.currentTime.toFixed(1), dur: v.duration, w: v.videoWidth, paused: v.paused, ready: v.readyState, err: v.error && v.error.code, src: v.currentSrc.replace(/^http:\\/\\/127.0.0.1:\\d+/, '') } : null; })()`;

  t('Offline Home/Movies list the downloaded files with parsed titles and no broken images', async () => {
    await offlineHome();
    await d().nav('Movies'); await sleep(1200);
    const titles = await d().texts('.search-results-grid .movie-card-title');
    assert(titles.includes('Test Movie'), 'library titles: ' + titles.join(', '));
    const meta = await d().ev(`[...document.querySelectorAll('.search-results-grid .movie-card')].find(c => c.querySelector('.movie-card-title').textContent === 'Test Movie').querySelector('.movie-card-meta').textContent`);
    assert(/2024/.test(meta), 'year not shown: ' + meta);
    const broken = await d().ev(`[...document.querySelectorAll('.movie-card img')].filter(i => i.style.display !== 'none' && i.complete && i.naturalWidth === 0).length`);
    assertEq(broken, 0, 'broken poster images visible');
    await d().shot('offline-movies');
    await d().nav('Home');
    assert((await d().texts('.section-title')).includes('Recently Added'), 'no Recently Added row');
  });

  t('Offline search finds local files', async () => {
    await offlineHome();
    await d().tap('.search-box'); await d().type('.search-input', 'test'); await sleep(1500);
    assert(await d().ev(`document.body.innerText.includes('Test Movie')`), 'local search found nothing');
    await d().type('.search-input', ''); await d().nav('Home');
  });

  t('library file plays from /media/<id>: Range bytes match the file, 416 past the end', async () => {
    await offlineHome();
    const item = (await d().ev('window.electronAPI.movies.getAll()')).find(m => m.title === 'Test Movie');
    assert(item, 'Test Movie not in library');
    const data = fs.readFileSync(movieFile); const size = data.length;
    const port = await d().ev('window.electronAPI.media.getPort()');
    const url = `http://127.0.0.1:${port}/media/${item.id}`;
    const rf = range => d().ev(`(async () => { const r = await fetch(${JSON.stringify(url)}, { headers: { Range: ${JSON.stringify(range)} } }); const b = new Uint8Array(await r.arrayBuffer()); return { s: r.status, n: b.length, cr: r.headers.get('content-range'), hex: [...b.slice(0, 64)].map(x => x.toString(16).padStart(2, '0')).join('') }; })()`);
    const a = await rf('bytes=0-1023'); assertEq(a.s, 206); assertEq(a.n, 1024); assertEq(a.cr, `bytes 0-1023/${size}`);
    assertEq(a.hex, data.subarray(0, 64).toString('hex'), 'first bytes');
    const mid = Math.floor(size / 3); const b = await rf(`bytes=${mid}-${mid + 4095}`);
    assertEq(b.hex, data.subarray(mid, mid + 64).toString('hex'), 'middle bytes');
    const c = await rf(`bytes=${size + 1}-`); assertEq(c.s, 416, 'past the end');
    const e = await rf('bytes=-100'); assertEq(e.n, 100, 'suffix range');
  });

  t('open a local movie: details, Play, controls, seek, close; progress lands in Continue Watching', async () => {
    await offlineHome(); await d().nav('Movies');
    await d().ev(`[...document.querySelectorAll('.search-results-grid .movie-card')].find(c => c.querySelector('.movie-card-title').textContent === 'Test Movie').click()`);
    await d().waitFor(`!!document.querySelector('.detail-actions .btn-primary')`, { message: 'details dialog' });
    assert(!(await d().ev(`document.body.innerText.includes('File Missing')`)), 'file reported missing');
    await d().tap('.detail-actions .btn-primary');
    const st = await d().waitFor(`(() => { const s = ${state}; return s && s.ready >= 3 && s.t > 2 && s.w > 0 ? s : null; })()`, { timeout: 40000, message: 'local playback' });
    assert(!st.err, 'video error ' + st.err); assert(/\/media\//.test(st.src), 'unexpected source ' + st.src);
    assert(Math.abs(st.dur - 45) < 1.5, 'duration ' + st.dur);
    assert(await d().ev('innerWidth > innerHeight'), 'player not landscape');
    await d().shot('offline-player');
    // seek through the player
    await d().ev(`document.querySelector('video').currentTime = 30`);
    await d().waitFor(`(() => { const s = ${state}; return s && s.t > 30.5 && !s.paused ? s : null; })()`, { timeout: 15000, message: 'playback after seek to 30s' });
    await d().tap('button[title^="Skip back"]'); await sleep(1500);
    assert((await d().ev(state)).t < 30, 'skip back did not rewind');
    await d().ev(`document.querySelector('video').currentTime = 20`); await sleep(6500);   // let the 5s progress save run
    await d().back(); await sleep(1500);
    assert(!(await d().exists('.player-overlay')), 'player still open');
    assert(await d().ev('innerHeight > innerWidth'), 'portrait not restored');
    await d().nav('Continue Watching'); await sleep(1500);
    assert(await d().ev(`document.body.innerText.includes('Test Movie')`), 'not listed under Continue Watching');
  }, { timeout: 150000 });

  t('My List: add from details, appears in My List, survives a reload', async () => {
    await offlineHome(); await d().nav('Movies');
    await d().ev(`[...document.querySelectorAll('.search-results-grid .movie-card')].find(c => c.querySelector('.movie-card-title').textContent === 'Test Movie').click()`);
    await d().waitFor(`!!document.querySelector('.detail-actions')`);
    await d().ev(`[...document.querySelectorAll('.detail-actions button')].find(b => /My List/.test(b.textContent)).click()`); await sleep(1200);
    await d().back(); await sleep(500);
    await d().nav('My List'); await sleep(1200);
    assert(await d().ev(`document.body.innerText.includes('Test Movie')`), 'not in My List');
    await d().reload(7000); await d().nav('My List'); await sleep(1200);
    assert(await d().ev(`document.body.innerText.includes('Test Movie')`), 'My List lost after reload');
  });

  t('Android hides the desktop-only Edit / Refresh metadata buttons', async () => {
    await offlineHome(); await d().nav('Movies');
    await d().ev(`[...document.querySelectorAll('.search-results-grid .movie-card')][0].click()`);
    await d().waitFor(`!!document.querySelector('.detail-actions')`);
    const visible = await d().ev(`[...document.querySelectorAll('.detail-actions .btn-sm')].filter(b => b.getBoundingClientRect().width > 0).map(b => b.textContent.trim())`);
    assert(visible.length === 0, 'desktop-only buttons shown: ' + visible.join(', '));
    await d().back();
  });

  t('Genres page and empty states do not crash', async () => {
    await offlineHome(); await d().pageErrors();
    await d().nav('Genres'); await sleep(1000);
    assert(await d().ev(`document.querySelector('.main-content').innerText.length > 10`), 'Genres page is blank');
    await d().nav('Home');
    const errs = (await d().pageErrors()).filter(e => !/ERR_|Failed to load resource/.test(e));
    assert(errs.length === 0, 'page errors: ' + errs.join(' | '));
  });
};
