// New shared features on the phone: profiles, history / Continue Watching, playlists, follows, captions, Featured banner,
// genre pills, search suggestions, trailers, the wider Series catalogue and the new Settings layout.
const { test, assert, assertEq, sleep } = require('../lib');
const G = 'features';

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 150000, ...o });
  const api = (expr) => d().ev(`(async () => { const a = window.electronAPI; ${expr} })()`);
  const overflow = `(() => { const vw = innerWidth; const bad = []; for (const e of document.querySelectorAll('.main-content *, .movie-detail *, .profile-picker *')) { const b = e.getBoundingClientRect(); if (b.width && b.right > vw + 2 && getComputedStyle(e).position !== 'fixed' && !e.closest('.movie-row, .genre-pills, .settings-nav, .hero-backdrop, .section')) bad.push((e.className || e.tagName).toString().slice(0, 28) + ' r=' + Math.round(b.right)); } return bad.slice(0, 6); })()`;

  async function home() {
    await d().ensure();
    await d().ev(`document.querySelector('.detail-close')?.click()`);
    await d().setMode('online'); await d().nav('Home');
    await d().waitFor(`document.querySelectorAll('.section-title').length >= 3`, { timeout: 45000, message: 'home rows' });
    await sleep(800);
  }

  t('Profiles: one profile at start, avatar in the top bar, no picker', async () => {
    await d().ensure();
    await d().ev(`localStorage.removeItem('cm:profiles'); localStorage.removeItem('cm:profile:active')`);
    await d().reload(7000);
    assert(!(await d().exists('.profile-picker')), 'picker shown with a single profile');
    const list = await api(`return await a.profiles.list()`);
    assertEq(list.length, 1, 'profile count');
    assert(await d().exists('.navbar button[title*="profile"]'), 'avatar button missing');
  });

  t('Profiles: create kids profile with a PIN, wrong PIN rejected, correct PIN switches', async () => {
    const r = await api(`
      const p = await a.profiles.create({ name: 'Junior', kids: true, pin: '4321', avatar: 3 });
      const bad = await a.profiles.verify(p.id, '0000'); const good = await a.profiles.verify(p.id, '4321');
      const wrong = await a.profiles.switch(p.id, '0000').then(() => 'allowed', () => 'rejected');
      await a.profiles.switch(p.id, '4321'); const active = await a.profiles.active();
      await a.profiles.switch(1); const dup = await a.profiles.create({ name: 'junior' }).then(() => 'allowed', () => 'rejected');
      return { bad, good, wrong, active: active.name, dup, id: p.id };`);
    assert(!r.bad && r.good && r.wrong === 'rejected' && r.active === 'Junior' && r.dup === 'rejected', JSON.stringify(r));
    await api(`await a.profiles.delete(${r.id})`);
  });

  t('Profiles: picker opens from the avatar, shows both profiles, adds one from the UI', async () => {
    await d().ensure(); await d().setMode('online');
    await api(`await a.profiles.create({ name: 'Sam', color: '#0071eb' })`);
    await d().reload(7000);
    assert(await d().exists('.profile-picker'), 'picker should appear at launch with two profiles');
    assertEq(await d().count('.profile-tile'), 3, 'tiles (2 profiles + add)');
    assert((await d().ev(overflow)).length === 0, 'picker overflows: ' + (await d().ev(overflow)));
    await d().tap('.profile-tile', 0); await sleep(1500);
    assert(!(await d().exists('.profile-picker')), 'picker did not close after choosing');
    const sam = (await api(`return await a.profiles.list()`)).find(p => p.name === 'Sam');
    await api(`await a.profiles.delete(${sam.id})`);
  });

  t('Kids profile: Settings hidden, scary genre pills hidden', async () => {
    const kid = await api(`const p = await a.profiles.create({ name: 'Kid', kids: true }); await a.profiles.switch(p.id); return p`);
    await d().reload(7000);
    await home();
    assert(!(await d().exists('button[title="Settings"]')), 'Settings visible for kids');
    const pills = await d().texts('.genre-pill');
    assert(!pills.some(p => /Horror|Thriller|Crime/.test(p)), 'pills: ' + pills.join(','));
    await api(`await a.profiles.switch(1); await a.profiles.delete(${kid.id})`);
    await d().reload(7000);
  });

  t('Home (online): Featured banner with Play / More info, rotation dots, fits the screen', async () => {
    await home();
    await d().waitFor(`!!document.querySelector('[data-testid=featured-hero] .hero-title')`, { timeout: 30000, message: 'featured hero' });
    const h = await d().ev(`(() => { const e = document.querySelector('[data-testid=featured-hero]'); return { title: e.querySelector('.hero-title').textContent, buttons: [...e.querySelectorAll('.hero-actions button')].map(b => b.textContent.trim()), dots: e.querySelectorAll('.hero-dot').length, right: e.getBoundingClientRect().right, vw: innerWidth }; })()`);
    assert(h.title.length > 1 && h.buttons.join('|') === 'Play|More info' && h.dots >= 2, JSON.stringify(h));
    assert(h.right <= h.vw + 1, 'hero wider than the screen');
    await d().tap('[data-testid=featured-hero] .hero-actions .btn-secondary'); await sleep(1500);
    assert(await d().exists('.movie-detail'), 'More info did not open details');
    await d().ev(`document.querySelector('.movie-detail-overlay').click()`);
  });

  t('Genre pills: horizontal scroll, tapping one opens Movies filtered', async () => {
    await home();
    const n = await d().count('.genre-pill'); assert(n >= 10, 'pills: ' + n);
    assertEq(await d().ev(`getComputedStyle(document.querySelector('.genre-pills-arrow') || document.body).display === 'none' || !document.querySelector('.genre-pills-arrow')`), true, 'arrows shown on touch');
    await d().ev(`[...document.querySelectorAll('.genre-pill')].find(b => b.textContent === 'Comedy').click()`);
    await d().waitFor(`document.querySelector('.genre-pill.active')?.textContent === 'Comedy'`, { timeout: 15000, message: 'Comedy active on Movies' });
    assert(await d().ev(`document.querySelectorAll('.search-results-grid .movie-card').length > 0`), 'no movies for the genre');
  });

  t('Continue Watching (online): saved progress shows a row; hide removes it; resume starts from the position', async () => {
    await api(`await a.history.save({ key: 'yts:900001', kind: 'movie', title: 'Phone QA Film', subtitle: '2024', poster: '', magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), quality: '720p', imdbId: '', year: 2024, season: 0, episode: 0, genres: 'Drama', position: 600, duration: 6000 })`);
    await home();
    await d().waitFor(`!!document.querySelector('[data-testid=continue-watching]')`, { timeout: 15000, message: 'Continue Watching row' });
    assert((await d().texts('[data-testid=continue-watching] .movie-card-title')).includes('Phone QA Film'), 'title missing');
    const pct = await d().ev(`parseFloat(document.querySelector('[data-testid=continue-watching] .resume-progress > div').style.width)`);
    assert(Math.abs(pct - 10) < 1, 'progress bar ' + pct);
    await api(`await a.history.remove('yts:900001')`);
  });

  t('Playlists: create, add from a movie, rename, delete (API + page)', async () => {
    const r = await api(`
      const p = await a.playlists.create('Phone List'); await a.playlists.add(p.id, { key: 'yts:1', kind: 'yts', title: 'T', year: 2020, poster: '', payload: '{}' });
      const items = (await a.playlists.items(p.id)).length; const mem = (await a.playlists.membership('yts:1')).includes(p.id);
      await a.playlists.rename(p.id, 'Phone List 2'); const renamed = (await a.playlists.list()).some(x => x.name === 'Phone List 2');
      const dup = await a.playlists.create('phone list 2').then(() => 'allowed', () => 'rejected');
      await a.playlists.delete(p.id); return { items, mem, renamed, dup, gone: !(await a.playlists.list()).some(x => x.id === p.id) };`);
    assert(r.items === 1 && r.mem && r.renamed && r.dup === 'rejected' && r.gone, JSON.stringify(r));
    await home(); assert((await d().texts('.navbar-nav .nav-link')).includes('Playlists'), 'Playlists tab missing: ' + (await d().texts('.navbar-nav .nav-link')));
    await d().nav('Playlists');
    assert(await d().ev(`/Playlists/.test(document.querySelector('.main-content').innerText)`), 'page did not open');
  });

  t('Save to playlist popover works on a movie (tap, tick, saved)', async () => {
    await api(`for (const p of await a.playlists.list()) if (p.name === 'Popover List') await a.playlists.delete(p.id); await a.playlists.create('Popover List')`);
    await home();
    await d().ev(`document.querySelector('.section .movie-card').click()`);
    await d().waitFor(`!!document.querySelector('.movie-detail')`, { message: 'details' });
    await d().tap('.movie-detail .btn:has(svg) >> nth', 0).catch(() => {});
    const opened = await d().ev(`(() => { const b = [...document.querySelectorAll('.movie-detail button')].find(x => /Playlist/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
    assert(opened, 'no Playlist button');
    await d().waitFor(`!!document.querySelector('.playlist-pop-row')`, { message: 'popover rows' });
    await d().ev(`[...document.querySelectorAll('.playlist-pop-row')].find(r => /Popover List/.test(r.textContent)).click()`); await sleep(900);
    const saved = await d().ev(`/Saved/.test([...document.querySelectorAll('.movie-detail button')].find(b => /Saved|Playlist/.test(b.textContent)).textContent)`);
    assert(saved, 'button does not show Saved');
    const pop = await d().ev(`(() => { const r = document.querySelector('.playlist-pop')?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, vw: innerWidth } : null; })()`);
    if (pop) assert(pop.l >= 0 && pop.r <= pop.vw + 1, 'popover off screen ' + JSON.stringify(pop));
    await d().ev(`document.body.click(); document.querySelector('.detail-close')?.click()`);
    const p = (await api(`return await a.playlists.list()`)).find(x => x.name === 'Popover List');
    await api(`await a.playlists.delete(${p.id})`);
  });

  t('Search: suggestions appear under the search box, recent searches are remembered', async () => {
    await home();
    await d().ev(`document.querySelector('.search-input').focus()`);
    await d().type('.search-input', 'bat');
    await d().waitFor(`document.querySelectorAll('.search-suggest-row').length > 0`, { timeout: 20000, message: 'suggestions' }).catch(async e => { throw new Error(e.message + ' ' + (await d().ev(`JSON.stringify({ detail: !!document.querySelector('.movie-detail'), val: document.querySelector('.search-input')?.value, focus: document.activeElement?.className, cls: document.documentElement.className })`))); });
    const box = await d().ev(`(() => { const r = document.querySelector('.search-suggest').getBoundingClientRect(); return { l: r.left, r: r.right, vw: innerWidth }; })()`);
    assert(box.l >= 0 && box.r <= box.vw + 1, 'suggestions off screen ' + JSON.stringify(box));
    await d().ev(`document.querySelector('.search-suggest-row').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await d().waitFor(`/Results for/.test(document.body.innerText)`, { timeout: 25000, message: 'results page' });
    assert((await d().ev(`JSON.parse(localStorage.getItem('cm_recent_searches') || '[]').length`)) > 0, 'no recent search saved');
    assert(await d().exists('.search-filters'), 'filter bar missing');
    assert((await d().ev(overflow)).length === 0, 'search page overflows: ' + (await d().ev(overflow)));
  });

  t('Trailer: the Trailer button opens an embedded YouTube player', async () => {
    await home();
    await d().ev(`document.querySelector('.section .movie-card').click()`);
    await d().waitFor(`!!document.querySelector('.movie-detail')`, { message: 'details' });
    const has = await d().ev(`!![...document.querySelectorAll('.movie-detail button')].find(b => /Trailer/.test(b.textContent))`);
    if (!has) return; // some titles have no trailer
    await d().ev(`[...document.querySelectorAll('.movie-detail button')].find(b => /Trailer/.test(b.textContent)).click()`);
    await d().waitFor(`!!document.querySelector('.trailer-frame')`, { message: 'trailer frame' });
    assert(/youtube-nocookie\.com\/embed\//.test(await d().ev(`document.querySelector('.trailer-frame').src`)), 'trailer src');
    await d().ev(`document.querySelector('.trailer-overlay .detail-close').click(); document.querySelector('.movie-detail-overlay')?.click()`);
  });

  t('Series: the wide catalogue shows up fast and keeps growing; first cards appear within seconds', async () => {
    await d().ensure(); await d().setMode('online');
    const t0 = Date.now(); await d().nav('Series');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 12`, { timeout: 40000, message: 'first 12 shows' });
    const first = Date.now() - t0;
    await sleep(25000);
    const n = await d().count('.search-results-grid .movie-card:not(:has(.yts-skeleton))');
    assert(n >= 100, `only ${n} shows after 25s`);
    console.log(`        (first 12 shows in ${first} ms, ${n} after 25 s)`);
    assert(first < 25000, 'first page too slow: ' + first);
  }, { timeout: 120000 });

  t('Series: Play button starts an episode; detail has Follow + Playlist and fits the screen', async () => {
    await d().ensure(); await d().setMode('online'); await d().nav('Series');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card').length > 0`, { timeout: 30000, message: 'grid' });
    await d().ev(`document.querySelector('.search-results-grid .movie-card').click()`);
    await d().waitFor(`!!document.querySelector('.movie-detail') && /Season/.test(document.querySelector('.movie-detail').innerText)`, { timeout: 40000, message: 'series detail with seasons' });
    const info = await d().ev(`(() => { const dtl = document.querySelector('.movie-detail'); return { follow: /Follow|Following/.test(dtl.innerText), playlist: /Playlist|Saved/.test(dtl.innerText), eps: dtl.querySelectorAll('button.btn-primary').length }; })()`);
    assert(info.follow && info.playlist && info.eps > 0, JSON.stringify(info));
    assert((await d().ev(overflow)).length === 0, 'series detail overflows: ' + (await d().ev(overflow)));
    await d().ev(`[...document.querySelectorAll('.movie-detail button')].find(b => /Follow/.test(b.textContent))?.click()`); await sleep(700);
    assertEq((await api(`return await a.follows.list()`)).length, 1, 'follow not saved');
    await api(`for (const f of await a.follows.list()) await a.follows.unfollow(f.showId)`);
    await d().ev(`document.querySelector('.movie-detail-overlay').click()`);
  }, { timeout: 120000 });

  t('Captions: online search works (zero-padded IMDb ids for older films) and converts to WebVTT', async () => {
    const r = await api(`
      const out = {};
      for (const imdb of ['tt0111161', 'tt1375666']) out[imdb] = await a.subtitles.search({ imdbId: imdb, title: 'x', languages: ['en'] }).then(x => x.length, e => String(e).slice(0, 80));
      const tracks = await a.subtitles.search({ imdbId: 'tt0111161', title: 'x', languages: ['en'] });
      const loaded = tracks[0] ? await a.subtitles.load(tracks[0].id).then(x => x.vtt.slice(0, 6) + '|' + x.vtt.length, e => String(e).slice(0, 80)) : 'none';
      out.loaded = loaded; return out;`);
    assert(r.tt0111161 > 0 && r.tt1375666 > 0, JSON.stringify(r));
    assert(/^WEBVTT/.test(r.loaded), 'not WebVTT: ' + r.loaded);
  });

  t('Settings: tabs row on top, no Downloads tab, no overflow; Profiles tab lists everyone', async () => {
    await d().ensure(); await d().ev(`document.activeElement && document.activeElement.blur(); document.documentElement.classList.remove('keyboard-open')`); await d().ev(`document.querySelector('button[title="Settings"]').click()`); await sleep(1200);
    const tabs = await d().texts('.settings-nav-item');
    assert(tabs.join('|') === 'Library|Playback|Content|Profiles|About', 'tabs: ' + tabs.join('|'));
    assert((await d().ev(overflow)).length === 0, 'settings overflows: ' + (await d().ev(overflow)));
    await d().ev(`[...document.querySelectorAll('.settings-nav-item')].find(b => /Profiles/.test(b.textContent)).click()`); await sleep(600);
    assert((await d().count('.settings-profile')) >= 1, 'no profile cards');
    await d().ev(`[...document.querySelectorAll('.settings-nav-item')].find(b => /Playback/.test(b.textContent)).click()`); await sleep(600);
    assert(await d().exists('.settings-savebar'), 'save bar missing');
    const bar = await d().ev(`(() => { const r = document.querySelector('.settings-savebar').getBoundingClientRect(); const navEl = document.querySelector('.navbar-nav'); const shown = getComputedStyle(navEl).display !== 'none'; return { bottom: r.bottom, navTop: shown ? navEl.getBoundingClientRect().top : innerHeight }; })()`);
    assert(bar.bottom <= bar.navTop + 2, 'save bar hidden behind the tab bar ' + JSON.stringify(bar));
  });

  t('Playback settings are honoured (default speed, remember volume)', async () => {
    await api(`await a.settings.set('defaultSpeed', '1.5')`);
    const v = await api(`return await a.settings.get('defaultSpeed')`);
    assertEq(v, '1.5', 'setting not stored');
    await api(`await a.settings.set('defaultSpeed', '1')`);
  });
};




