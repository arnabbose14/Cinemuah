const { test, assert, assertEq, sleep, adb, sh, PKG } = require('../lib');
const G = 'nav';

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 120000, ...o });
  const resumed = () => sh('dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"');

  async function home(mode = 'online') {
    await d().ensure();
    // make sure we are in a known state: leave dialogs, go Home
    await d().ev(`document.querySelector('.movie-detail-overlay')?.click()`);
    // an earlier suite (search) can leave the search box focused: it would expand over the top-bar buttons and its
    // on-screen keyboard would swallow the first Back press, so drop the focus first
    await d().ev(`document.activeElement && document.activeElement !== document.body && document.activeElement.blur()`);
    await sleep(400);
    await d().setMode(mode);
    await d().nav('Home');
  }

  t('Online tabs: Home, Movies, Series', async () => {
    await home('online');
    assertEq((await d().texts('.navbar-nav .nav-link')).join(','), 'Home,Movies,Series,Playlists');
  });

  t('Offline tabs: Home, Movies, Genres, Continue Watching, My List', async () => {
    await home('offline');
    assertEq((await d().texts('.navbar-nav .nav-link')).join(','), 'Home,Movies,Genres,Continue Watching,My List,Playlists');
    await d().setMode('online');
  });

  t('every tab opens its page without errors', async () => {
    await d().pageErrors();
    await d().setMode('online');
    for (const tab of ['Movies', 'Series', 'Home']) {
      await d().nav(tab); await sleep(1200);
      assertEq(await d().page(), tab);
    }
    await d().setMode('offline');
    for (const tab of ['Movies', 'Genres', 'Continue Watching', 'My List', 'Home']) {
      await d().nav(tab); await sleep(900);
      assertEq(await d().page(), tab);
    }
    await d().setMode('online');
    const errs = (await d().pageErrors()).filter(e => !/ERR_|Failed to load resource|Unable to resolve host/.test(e));
    assert(errs.length === 0, 'page errors: ' + errs.slice(0, 3).join(' | '));
  });

  t('Settings and Downloads open from the top bar; logo returns Home', async () => {
    await home('online');
    await d().tap('button[title="Settings"]'); await sleep(700);
    assert(await d().ev(`/media library/i.test(document.body.innerText)`), 'settings not shown');
    await d().tap('.navbar-logo'); await sleep(600);
    assertEq(await d().page(), 'Home');
    await d().tap('button[title="Downloads"]'); await sleep(700);
    assert(await d().ev(`/downloads/i.test(document.querySelector('.main-content').innerText)`), 'downloads page not shown');
    await d().tap('.navbar-logo'); await sleep(600);
    assertEq(await d().page(), 'Home');
  });

  t('Back button: closes a dialog first and stays in the app', async () => {
    await home('online');
    await d().waitFor(`document.querySelectorAll('.section .movie-card:not(:has(.yts-skeleton))').length > 5`, { timeout: 30000 });
    await d().ev(`[...document.querySelectorAll('.section')].find(x => x.querySelector('.section-title').textContent === 'New Releases').querySelector('.movie-card').click()`);
    await d().waitFor(`!!document.querySelector('.movie-detail-overlay')`);
    await d().back();
    assert(!(await d().exists('.movie-detail-overlay')), 'dialog still open after Back');
    assert(/MainActivity/.test(resumed()), 'app was left while a dialog was open');
  });

  t('Back button: Settings, Downloads and other tabs go Home (not out of the app)', async () => {
    await home('online');
    for (const open of [
      async () => d().tap('button[title="Settings"]'),
      async () => d().tap('button[title="Downloads"]'),
      async () => d().nav('Series'),
      async () => d().nav('Movies'),
    ]) {
      await open(); await sleep(700);
      await d().back();
      assert(/MainActivity/.test(resumed()), 'Back left the app instead of going Home');
      assertEq(await d().page(), 'Home', 'did not return Home');
    }
  });

  t('Back button on Home leaves the app', async () => {
    await home('online');
    await d().back(); await sleep(1500);
    assert(!/MainActivity/.test(resumed()), 'app still in the foreground after Back on Home');
    await d().launch(); await sleep(5000);       // bring it back for the remaining tests
  });

  t('mode and settings survive killing and relaunching the app', async () => {
    await d().setMode('offline');
    await d().ev(`localStorage.setItem('cm:setting:languages', 'en,hi')`);
    // like swiping the app away: it goes to the background first (which flushes web storage), then the process is killed
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(3000);
    adb('shell', 'am', 'force-stop', PKG); await sleep(1500);
    await d().launch(); await sleep(6000);
    assertEq(await d().ev(`document.querySelector('.mode-switch-btn.active').title.startsWith('Offline')`), true, 'mode lost');
    assertEq(await d().ev(`localStorage.getItem('cm:setting:languages')`), 'en,hi', 'settings lost');
    await d().ev(`localStorage.removeItem('cm:setting:languages')`);
    await d().setMode('online');
  });

  t('rotation to landscape keeps the layout usable, then back to portrait', async () => {
    await home('online');
    await d().setRotation(1); await sleep(2000);
    const m = await d().ev(`({ vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, tabsBottom: Math.round(document.querySelector('.navbar-nav').getBoundingClientRect().bottom) })`);
    assert(m.vw > m.vh, 'did not rotate: ' + JSON.stringify(m));
    assert(m.sw <= m.vw + 1, 'horizontal scroll in landscape ' + JSON.stringify(m));
    assert(m.tabsBottom <= m.vh + 1, 'tab bar off-screen in landscape');
    await d().shot('landscape-home');
    await d().setRotation(0); await sleep(2000);
    assert(await d().ev('innerHeight > innerWidth'), 'did not return to portrait');
  });
};
