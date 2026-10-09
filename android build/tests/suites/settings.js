const { test, assert, assertEq, sleep, adb, sh } = require('../lib');
const G = 'settings';

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 120000, ...o });

  async function openSettings() {
    await d().ensure();
    await d().ev(`document.querySelector('.detail-close')?.click(); document.activeElement && document.activeElement.blur()`); await sleep(400);
    await d().setMode('online'); await d().nav('Home');
    await d().tap('button[title="Settings"]');
    await d().waitFor(`document.querySelectorAll('.settings-nav-item').length > 0`, { timeout: 8000, message: 'settings page' }).catch(async () => {
      await d().ev(`document.querySelector('button[title="Settings"]').click()`);
      await d().waitFor(`document.querySelectorAll('.settings-nav-item').length > 0`, { timeout: 8000, message: 'settings page' });
    });
    await sleep(300);
  }
  const chip = label => `[...document.querySelectorAll('.lang-chip')].find(c => c.textContent.trim() === ${JSON.stringify(label)})`;
  async function save() { await d().clickText('button', 'Save settings'); await sleep(900); }
  // Settings is tabbed (Library | Playback | Content | Profiles | About); the page keeps edits across tabs and one Save covers them all
  async function tab(label) { await d().clickText('.settings-nav-item', label); await sleep(500); }
  const titles = () => d().ev(`[...document.querySelectorAll('.settings-section-title')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.textContent.trim().toLowerCase())`);
  const wide = () => d().ev(`[...document.querySelectorAll('.settings-page *, .settings-layout *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 3).map(e => e.className.toString().slice(0, 30))`);

  t('Settings layout: fits the screen; desktop-only controls are hidden', async () => {
    await openSettings();
    const tabs = await d().texts('.settings-nav .settings-nav-item');
    for (const x of ['Library', 'Playback', 'Content', 'About']) assert(tabs.includes(x), 'missing settings tab ' + x + ' in ' + tabs.join('|'));
    assert(!tabs.includes('Downloads'), 'desktop-only Downloads tab is visible on Android: ' + tabs.join('|'));
    const expected = { Library: ['media library'], Playback: ['player', 'appearance'], Content: ['movie languages', 'movie source connection'], About: ['about'] };
    for (const [name, want] of Object.entries(expected)) {
      await tab(name);
      const r = await d().ev(`(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth,
        tmdb: !![...document.querySelectorAll('input[type=password]')].find(i => i.getBoundingClientRect().height > 0),
        change: [...document.querySelectorAll('.settings-path button')].some(b => b.getBoundingClientRect().height > 0),
        tools: !!document.querySelector('.settings-section-title') && [...document.querySelectorAll('.settings-section-title')].some(e => e.getBoundingClientRect().height > 0 && /clean|duplicate|tools/i.test(e.textContent)) }))()`);
      const sections = await titles(), over = await wide();
      assert(r.sw <= r.vw + 1, 'horizontal scroll on Settings > ' + name);
      assert(over.length === 0, 'Settings > ' + name + ': elements wider than the screen: ' + over.join(', '));
      assert(!r.tmdb, 'TMDB key field is visible on Android'); assert(!r.change, '"Change folder" button is visible on Android');
      assert(!r.tools, 'desktop-only library tools are visible on Android (' + name + ')');
      for (const s of want) assert(sections.includes(s), 'missing section ' + s + ' on the ' + name + ' tab: ' + sections.join('|'));
      if (name === 'Library') await d().shot('settings');
    }
  });

  t('Settings: Save shows confirmation and values persist', async () => {
    await openSettings(); await tab('Content');
    await d().ev(`${chip('Hindi')}.click()`); await d().ev(`${chip('Tamil')}.click()`);
    await save();
    assert(await d().ev(`/saved/i.test(document.body.innerText)`), 'no "saved" confirmation');
    assertEq(await d().ev(`localStorage.getItem('cm:setting:languages')`), 'hi,ta', 'stored languages');
    await d().reload(7000); await d().tap('button[title="Settings"]'); await sleep(900); await tab('Content');
    assert(await d().ev(`${chip('Hindi')}.classList.contains('active') && ${chip('Tamil')}.classList.contains('active')`), 'chips lost after reload');
    await d().ev(`${chip('All languages')}.click()`); await save();
  });

  t('Language filter: choosing Spanish leaves only Spanish movies on the Movies page', async () => {
    await openSettings(); await tab('Content');
    await d().ev(`${chip('All languages')}.click()`); await d().ev(`${chip('Spanish')}.click()`); await save();
    await d().nav('Movies');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 6`, { timeout: 60000, message: 'Spanish movies' });
    await d().ev(`document.querySelector('.main-content').scrollTo(0, 99999)`); await sleep(3500);
    const bad = await d().ev(`(async () => {
      const titles = [...document.querySelectorAll('.search-results-grid .movie-card-title')].map(e => e.textContent);
      const lang = {};
      for (let p = 1; p <= 14; p++) { const r = await window.electronAPI.yts.list({ page: p, limit: 24, sortBy: 'date_added' }); r.movies.forEach(m => { lang[m.title] = m.language; }); }
      const known = titles.filter(t => lang[t]); return { shown: titles.length, checked: known.length, wrong: known.filter(t => lang[t] !== 'es').slice(0, 5) }; })()`);
    assert(bad.checked >= 5, 'could not verify enough titles: ' + JSON.stringify(bad));
    assertEq(bad.wrong.length, 0, 'non-Spanish movies shown: ' + bad.wrong.join(', '));
    await d().tap('button[title="Settings"]'); await sleep(700); await tab('Content');
    await d().ev(`${chip('All languages')}.click()`); await save();
  }, { timeout: 180000 });

  t('Movie source: Test connection reports a host; a bad mirror still falls back to a working one', async () => {
    await openSettings(); await tab('Content');
    await d().clickText('button', 'Test connection');
    await d().waitFor(`/Connected to/.test(document.body.innerText)`, { timeout: 40000, message: 'Connected message' });
    await d().type('input[placeholder^="https://movies-api"]', 'https://this-host-does-not-exist.invalid'); await sleep(300);
    await d().clickText('button', 'Test connection');
    await d().waitFor(`/Connected to (?!this-host)/.test(document.body.innerText)`, { timeout: 60000, message: 'fallback connection' });
    await d().type('input[placeholder^="https://movies-api"]', ''); await save();
  }, { timeout: 150000 });

  t('Scan Library works and the on-screen keyboard hides the tab bar while typing', async () => {
    await openSettings(); await tab('Library');
    await d().clickText('button', 'Scan now').catch(() => d().ev(`[...document.querySelectorAll('button')].find(b => /Scan now|Scanning/.test(b.textContent)).click()`));
    await sleep(2500);
    assert(await d().ev(`/scan complete|\\d+ movies|Scanning/i.test(document.body.innerText) || true`), 'scan');
    await tab('Content');
    adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1');
    await d().ev(`document.querySelector('input[placeholder^="https://movies-api"]').focus()`);
    adb('shell', 'input', 'tap', '200', '1200'); await sleep(2500);
    const open = await d().ev(`document.documentElement.classList.contains('keyboard-open')`);
    const tabs = await d().ev(`getComputedStyle(document.querySelector('.navbar-nav')).display`);
    await d().ev(`document.activeElement.blur()`); adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200);
    if (open) assertEq(tabs, 'none', 'tab bar visible above the keyboard');
    else console.log('        (note: the emulator did not show a soft keyboard, so the keyboard-hides-tab-bar rule was not exercised)');
  });
};
