const { test, assert, assertEq, sleep } = require('../lib');
const G = 'online';

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 150000, ...o });
  const SECTIONS = ['Popular Series', 'New Releases', 'Most Downloaded', 'Top Rated'];
  const cards = sel => `${sel} .movie-card:not(:has(.yts-skeleton))`;
  const rowCard = (title, i = 0) => `[...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title').textContent === ${JSON.stringify(title)}).querySelectorAll('.movie-card')[${i}]`;

  // Genres are pills (not a <select>) since the Movies page redesign; the selects are quality and sort order
  const pill = label => d().ev(`[...document.querySelectorAll('.genre-pill')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);

  async function openHome() {
    await d().ensure();
    await d().ev(`document.querySelector('.movie-detail-overlay')?.click()`);
    await d().setMode('online'); await d().nav('Home');
    await d().waitFor(`[...document.querySelectorAll('.section-title')].map(e => e.textContent).includes('Top Rated')`, { timeout: 45000, message: 'four online rows' });
    await sleep(1200);
  }
  const fits = `(() => { const vw = innerWidth; const bad = []; for (const e of document.querySelectorAll('.movie-detail *')) { const b = e.getBoundingClientRect(); if (b.width && b.right > vw + 1 && getComputedStyle(e).position !== 'absolute' && !e.closest('.movie-row')) bad.push((e.className || e.tagName).toString().slice(0, 30) + ' right=' + Math.round(b.right)); } return bad.slice(0, 5); })()`;

  t('Home: the four online rows load with real cards', async () => {
    await openHome();
    for (const s of SECTIONS) {
      const n = await d().ev(`(() => { const sec = [...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title')?.textContent === ${JSON.stringify(s)}); return sec ? sec.querySelectorAll('.movie-card:not(:has(.yts-skeleton))').length : -1; })()`);
      assert(n >= 8, `row "${s}" has ${n} cards`);
    }
  });

  t('Home: posters render through the local image server (>=90%)', async () => {
    await openHome(); await sleep(7000);
    const r = await d().ev(`(() => { const imgs = [...document.querySelectorAll('.section .movie-card img')]; return { total: imgs.length, ok: imgs.filter(i => i.naturalWidth > 0).length, sample: imgs[0]?.src }; })()`);
    assert(r.total >= 30, 'only ' + r.total + ' poster images');
    assert(/^http:\/\/127\.0\.0\.1:\d+\/yts-image/.test(r.sample) || /\/yts-image/.test(r.sample), 'posters not via the proxy: ' + r.sample);
    assert(r.ok / r.total >= 0.9, `${r.ok}/${r.total} posters loaded`);
  });

  t('Home: no duplicate titles per row, no undefined/NaN text', async () => {
    await openHome();
    const dupes = await d().ev(`(() => { const out = []; for (const sec of document.querySelectorAll('.section')) { const seen = new Set(); for (const n of [...sec.querySelectorAll('.movie-card-title')].map(e => e.textContent)) { if (seen.has(n)) out.push(n); seen.add(n); } } return out; })()`);
    assert(dupes.length === 0, 'duplicates: ' + dupes.join(', '));
    assert(!(await d().ev(`/\\bundefined\\b|\\bNaN\\b|\\[object/.test(document.querySelector('.main-content').innerText)`)), 'undefined/NaN on page');
  });

  t('Home: a row scrolls by finger swipe; the desktop arrows are hidden on touch', async () => {
    await openHome();
    const box = await d().ev(`(() => { const r = document.querySelector('.movie-row').getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; })()`);
    const before = await d().ev(`document.querySelector('.movie-row').scrollLeft`);
    await d().swipe(box.x + box.w - 30, box.y, box.x + 30, box.y); await sleep(600);
    const after = await d().ev(`document.querySelector('.movie-row').scrollLeft`);
    assert(after > before + 40, `row did not scroll (${before} -> ${after})`);
    assertEq(await d().ev(`getComputedStyle(document.querySelector('.row-scroll-btn')).display`), 'none', 'row arrows visible on touch');
  });

  t('Movie card tap -> details: torrents, default pick, buttons fit the screen', async () => {
    await openHome();
    await d().ev(`${rowCard('Most Downloaded')}.click()`);
    await d().waitFor(`!!document.querySelector('.movie-detail-overlay input[name=torrent]')`, { message: 'torrent list' });
    const info = await d().ev(`({ rows: [...document.querySelectorAll('input[name=torrent]')].map(i => i.closest('label').innerText.replace(/\\s+/g, ' ').trim()), selected: document.querySelector('input[name=torrent]:checked')?.closest('label').innerText.replace(/\\s+/g, ' ').trim(), buttons: [...document.querySelectorAll('.detail-content .btn')].map(b => b.textContent.trim()) })`);
    assert(info.rows.length >= 1 && info.rows.every(r => !/\b0 peers\b/.test(r)), 'torrent rows: ' + info.rows.join(' | '));
    if (info.rows.some(r => r.startsWith('1080p'))) assert(info.selected.startsWith('1080p'), 'default not 1080p: ' + info.selected);
    assert(info.buttons.some(b => /Stream/.test(b)) && info.buttons.some(b => /Download/.test(b)), 'buttons: ' + info.buttons);
    const overflow = await d().ev(fits); assert(overflow.length === 0, 'content outside the screen: ' + overflow.join(', '));
    await d().shot('movie-details');
    await d().back();
  });

  t('Series card tap -> seasons and episodes, layout fits, Back closes', async () => {
    await openHome();
    await d().ev(`${rowCard('Popular Series')}.click()`);
    // (the header's Follow button is also .btn-primary, so wait for the season select / Play buttons instead)
    await d().waitFor(`document.querySelectorAll('.movie-detail select').length === 2 && document.querySelectorAll('.movie-detail button[title^="Stream"]').length > 0`, { timeout: 60000, message: 'episodes with Play' })
      .catch(async e => { throw new Error(e.message + ' | detail text: ' + (await d().ev(`document.querySelector('.movie-detail')?.innerText.replace(/\\s+/g, ' ').slice(0, 400)`))); });
    const info = await d().ev(`({ title: document.querySelector('.detail-title').textContent, selects: [...document.querySelectorAll('.movie-detail select')].map(s => s.options.length), play: document.querySelectorAll('.movie-detail button[title^="Stream"]').length, season: document.body.innerText.match(/Download season \\((\\d+)\\)/)?.[1] })`);
    assert(info.selects.length === 2 && info.selects[0] >= 1, 'season/quality selects: ' + JSON.stringify(info.selects));
    assertEq(String(info.play), info.season, 'Play buttons vs "Download season (N)"');
    const overflow = await d().ev(fits); assert(overflow.length === 0, 'content outside the screen: ' + overflow.join(', '));
    await d().shot('series-details');
    await d().back();
    assert(!(await d().exists('.movie-detail-overlay')), 'dialog still open after Back');
  });

  t('Movies page: 3-column grid, finger-scroll loads more, no duplicates', async () => {
    await openHome(); await d().nav('Movies');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 20`, { timeout: 40000 });
    const cols = await d().ev(`(() => { const xs = [...document.querySelectorAll('.search-results-grid .movie-card')].slice(0, 12).map(c => Math.round(c.getBoundingClientRect().left)); return new Set(xs).size; })()`);
    assert(cols >= 3, 'grid has ' + cols + ' columns');
    const n0 = await d().count('.search-results-grid .movie-card:not(:has(.yts-skeleton))');
    for (let i = 0; i < 4; i++) await d().flick();
    await d().ev(`document.querySelector('.main-content').scrollTo(0, document.querySelector('.main-content').scrollHeight)`);
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length > ${n0}`, { timeout: 30000, message: 'more movies after scrolling' });
    const dupes = await d().ev(`(() => { const t = [...document.querySelectorAll('.search-results-grid .movie-card-title')].map(e => e.textContent + '|' + e.nextElementSibling?.textContent); return t.length - new Set(t).size; })()`);
    assert(dupes === 0, dupes + ' duplicate cards');
    await d().shot('movies-grid');
  });

  t('Movies filters fit on screen and change the results', async () => {
    await openHome(); await d().nav('Movies');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 10`, { timeout: 40000 });
    const bad = await d().ev(`[...document.querySelectorAll('.main-content select')].filter(s => s.getBoundingClientRect().right > innerWidth).length`);
    assertEq(bad, 0, 'filters overflow the screen');
    const before = (await d().texts('.search-results-grid .movie-card-title', 8)).join('|');
    await pill('Horror'); await sleep(3500);
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 5`, { timeout: 30000 });
    const after = (await d().texts('.search-results-grid .movie-card-title', 8)).join('|');
    assert(before !== after, 'genre filter did not change the feed');
    await pill('All');
  });

  t('Series page: grid loads and loads more on scroll', async () => {
    await openHome(); await d().nav('Series');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 20`, { timeout: 45000 });
    const n0 = await d().count('.search-results-grid .movie-card:not(:has(.yts-skeleton))');
    await d().ev(`document.querySelector('.main-content').scrollTo(0, document.querySelector('.main-content').scrollHeight)`);
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length > ${n0}`, { timeout: 30000, message: 'more shows' });
  });

  t('Search: icon expands to a full-width box, finds series AND movies, clear returns Home', async () => {
    await openHome(); await d().nav('Movies');
    await d().tap('.search-box');
    assert(await d().ev(`document.activeElement?.classList.contains('search-input')`), 'search input not focused after tap');
    const box = await d().ev(`(() => { const b = document.querySelector('.search-box').getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), vw: innerWidth }; })()`);
    assert(box.r - box.l > box.vw * 0.8, 'search box did not expand: ' + JSON.stringify(box));
    await d().type('.search-input', 'dark'); await sleep(4500);
    const r = await d().ev(`({ h1: document.querySelector('h1')?.textContent, sections: [...document.querySelectorAll('h2')].map(h => h.textContent).filter(x => /^(Series|Movies)/.test(x)) })`);
    assert(/dark/.test(r.h1) && r.sections.length === 2, 'results: ' + JSON.stringify(r));
    await d().shot('search-dark');
    await d().tap('.search-box button');   // the clear (x) button
    await sleep(900);
    assertEq(await d().page(), 'Home', 'clear did not return Home');
  });

  t('Search: nonsense query shows "Nothing found"', async () => {
    await openHome(); await d().type('.search-input', 'zzqxwv'); await sleep(4500);
    assert(await d().ev(`/nothing found/i.test(document.body.innerText)`), 'no empty-state message');
    await d().type('.search-input', ''); await sleep(800);
  });

  t('Offline (airplane mode): clear error with Retry, then recovers', async () => {
    await openHome(); await d().nav('Movies');
    await d().ev(`localStorage.clear()`);
    await d().setAirplane(true);
    await pill('Western');   // a feed this session has not loaded yet, so nothing is served from the in-memory cache
    try {
    await d().waitFor(`/couldn.t load|could not reach/i.test(document.body.innerText) && [...document.querySelectorAll('button')].some(b => /retry/i.test(b.textContent))`, { timeout: 60000, message: 'error message with Retry' });
    assert(await d().ev(`[...document.querySelectorAll('button')].some(b => /retry/i.test(b.textContent))`), 'no Retry button');
    await d().shot('no-network');
  } finally { await d().setAirplane(false); }
    await d().clickText('button', 'Save & Retry').catch(() => d().clickText('button', 'Retry'));
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 5`, { timeout: 60000, message: 'recovery' });
  }, { timeout: 240000 });
};
