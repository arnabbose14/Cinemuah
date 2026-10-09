const { test, assert, assertEq, sleep, adb, sh, PKG } = require('../lib');
const G = 'lifecycle';

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, timeout: 180000, ...o });

  t('background for 10s and return: same page, same scroll position', async () => {
    await d().ensure(); await d().setMode('online'); await d().nav('Series');
    await d().waitFor(`document.querySelectorAll('.search-results-grid .movie-card:not(:has(.yts-skeleton))').length >= 20`, { timeout: 45000 });
    await d().ev(`document.querySelector('.main-content').scrollTo(0, 900)`);
    await d().waitFor(`Math.abs(document.querySelector('.main-content').scrollTop - 900) < 2`, { timeout: 15000, message: 'scroll settles at 900' }).catch(() => {});
    await sleep(600);
    const y0 = await d().ev(`document.querySelector('.main-content').scrollTop`);
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(10000);
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`); await sleep(2500);
    assertEq(await d().page(), 'Series', 'page after returning');
    const y1 = await d().ev(`document.querySelector('.main-content').scrollTop`);
    assert(Math.abs(y1 - y0) < 5, `scroll position lost (${y0} -> ${y1})`);
    assertEq(d().fatals(), '', 'crash');
  });

  t('leftover partial files from a killed app are removed on the next start', async () => {
    await d().ensure();
    const root = `/sdcard/Android/data/${PKG}/files`;
    adb('shell', `mkdir -p ${root}/stream/deadbeef ${root}/downloads/cafebabe ${root}/magnet/x && dd if=/dev/zero of=${root}/stream/deadbeef/junk.bin bs=1M count=3 2>/dev/null; echo ok`);
    assert(Number(sh(`ls ${root}/stream | wc -l`)) >= 1, 'could not create the test leftovers');
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(1500);
    adb('shell', 'am', 'force-stop', PKG); await sleep(1500);
    await d().launch(); await sleep(7000);
    await d().ev(`window.electronAPI.torrent.stats()`);   // touches the engine so it starts
    await sleep(1500);
    assertEq(sh(`ls ${root}/stream ${root}/downloads ${root}/magnet 2>/dev/null | grep -v : | grep -c .`).trim(), '0', 'leftovers still on disk');
  });

  t('landscape: Home, Movies, Series, Settings, Downloads have no horizontal overflow', async () => {
    await d().ensure(); await d().setMode('online'); await d().nav('Home');
    await d().setRotation(1); await sleep(2500);
    const results = [];
    for (const [name, open] of [['Home', () => d().nav('Home')], ['Movies', () => d().nav('Movies')], ['Series', () => d().nav('Series')], ['Settings', () => d().tap('button[title="Settings"]')], ['Downloads', () => d().tap('button[title="Downloads"]')]]) {
      await open(); await sleep(1800);
      const m = await d().ev(`({ vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, tabs: Math.round(document.querySelector('.navbar-nav').getBoundingClientRect().bottom) })`);
      results.push(`${name}:${m.vw}x${m.vh}`);
      assert(m.vw > m.vh, name + ' not landscape'); assert(m.sw <= m.vw + 1, `${name} overflows horizontally (${m.sw} > ${m.vw})`); assert(m.tabs <= m.vh + 1, name + ' tab bar off-screen');
    }
    await d().shot('landscape-downloads');
    await d().setRotation(0); await sleep(2500);
    await d().nav('Home');
    assert(await d().ev('innerHeight > innerWidth'), 'did not return to portrait');
  });

  t('monkey stress: 600 random touch events cause no crash or ANR', async () => {
    await d().ensure(); await d().setMode('online'); await d().nav('Home'); await sleep(2000);
    const r = adb('shell', 'monkey', '-p', PKG, '--throttle', '120', '--pct-syskeys', '0', '--pct-appswitch', '0', '--pct-nav', '0', '--pct-majornav', '0', '-s', '11', '--ignore-security-exceptions', '600');
    const out = r.out + r.err;
    assert(!/CRASH|ANR/.test(out), 'monkey reported a failure:\n' + out.split('\n').filter(l => /CRASH|ANR|Exception/.test(l)).slice(0, 6).join('\n'));
    await sleep(1500);
    assertEq(d().fatals(), '', 'native crash after the stress run');
    assert(sh(`pidof ${PKG}`), 'app process is gone');
  }, { timeout: 240000 });

  t('memory after heavy use stays reasonable', async () => {
    await d().ensure();
    const out = sh(`dumpsys meminfo ${PKG} | grep -E "TOTAL PSS|TOTAL:"`);
    const m = /TOTAL(?: PSS)?:?\s+(\d+)/.exec(out);
    assert(m, 'could not read meminfo: ' + out);
    const mb = Math.round(Number(m[1]) / 1024);
    console.log(`        (total PSS ${mb} MB)`);
    assert(mb < 650, `app uses ${mb} MB`);
  });
};
