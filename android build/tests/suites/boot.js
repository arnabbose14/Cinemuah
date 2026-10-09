const { test, assert, assertEq, sleep, adb } = require('../lib');
const G = 'boot';

module.exports = (ctx) => {
  const d = () => ctx.d;
  const t = (name, fn, o) => test(name, fn, { group: G, ...o });

  t('app is running and the page loaded', async () => {
    assert(d().pid(), 'app process not running');
    assertEq(await d().ev('location.origin'), 'http://localhost', 'origin');
    assertEq(await d().ev('document.title'), 'Cinemuah', 'title');
    assert(await d().ev(`!!document.querySelector('.navbar-logo-img') && document.querySelector('.navbar-logo-img').naturalWidth > 0`), 'logo missing');
  });

  t('native bridge: media server port and Android class on <html>', async () => {
    const port = await d().ev('window.electronAPI.media.getPort()');
    assert(port > 1024, 'bad port ' + port);
    assert(await d().ev(`document.documentElement.classList.contains('android')`), 'html.android missing');
  });

  t('media server: CORS, image proxy rules, unknown routes', async () => {
    const r = await d().ev(`(async () => {
      const port = await window.electronAPI.media.getPort(); const b = 'http://127.0.0.1:' + port; const out = {};
      const info = await fetch(b + '/info/media/1'); out.info = [info.status, info.headers.get('access-control-allow-origin'), (await info.json()).direct];
      out.bad = (await fetch(b + '/yts-image?u=' + encodeURIComponent('https://evil.example.com/a.jpg'))).status;
      out.missing = (await fetch(b + '/yts-image')).status;
      out.http = (await fetch(b + '/yts-image?u=' + encodeURIComponent('http://yts.mx/a.jpg'))).status;
      out.nf = (await fetch(b + '/nope')).status;
      out.torrent = (await fetch(b + '/torrent/' + '0'.repeat(40) + '/0')).status;
      out.media = (await fetch(b + '/media/123456')).status;
      const o = await fetch(b + '/torrent/' + '0'.repeat(40) + '/0', { method: 'OPTIONS' }); out.options = o.status;
      return out; })()`);
    assertEq(r.info[0], 200, '/info'); assertEq(r.info[2], true, 'direct flag');
    assertEq(r.bad, 403, 'disallowed image host'); assertEq(r.missing, 400, 'missing u'); assertEq(r.http, 403, 'plain http image host');
    assertEq(r.nf, 404, 'unknown route'); assertEq(r.torrent, 404, 'inactive torrent'); assertEq(r.media, 404, 'unknown media id');
    assertEq(r.options, 200, 'CORS preflight');
  });

  t('image proxy serves a real poster', async () => {
    const r = await d().ev(`(async () => {
      const port = await window.electronAPI.media.getPort();
      const list = await window.electronAPI.yts.list({ page: 1, limit: 5 });
      const url = list.movies[0].poster;
      const res = await fetch('http://127.0.0.1:' + port + '/yts-image?u=' + encodeURIComponent(url));
      const buf = await res.arrayBuffer(); return { status: res.status, type: res.headers.get('content-type'), bytes: buf.byteLength, url }; })()`);
    assertEq(r.status, 200, 'status for ' + r.url); assert(/image\//.test(r.type), 'content-type ' + r.type); assert(r.bytes > 5000, 'tiny image ' + r.bytes);
  });

  t('layout: top bar, bottom tab bar, no horizontal scroll', async () => {
    await d().setMode('online'); await d().nav('Home');
    const m = await d().ev(`(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) }; };
      return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, navbar: r('.navbar'), tabs: r('.navbar-nav'), search: r('.search-box'), logo: r('.navbar-logo-img'), titlebar: getComputedStyle(document.querySelector('.titlebar')).display }; })()`);
    assert(m.sw <= m.vw + 1, `horizontal scroll: ${m.sw} > ${m.vw}`);
    assertEq(m.titlebar, 'none', 'desktop title bar visible');
    assertEq(m.navbar.top, 0, 'top bar not at the top'); assert(m.navbar.h >= 52 && m.navbar.h <= 64, 'top bar height ' + m.navbar.h);
    assert(m.tabs.bottom <= m.vh + 1 && m.tabs.h >= 50, `tab bar position ${JSON.stringify(m.tabs)} vh=${m.vh}`);
    assert(m.navbar.right <= m.vw, 'top bar overflows the screen');
  });

  t('tap targets are at least 40px (nav tabs and top-bar buttons)', async () => {
    const small = await d().ev(`(() => { const out = []; for (const e of document.querySelectorAll('.navbar-nav .nav-link, .navbar-right button, .navbar-right .search-box')) { const b = e.getBoundingClientRect(); if (b.width === 0) continue; if (b.width < 40 || b.height < 40) out.push((e.title || e.className || e.textContent).toString().slice(0, 30) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height)); } return out; })()`);
    assert(small.length === 0, 'small tap targets: ' + small.join(', '));
  });

  t('tab bar is fully opaque', async () => {
    const bg = await d().ev(`getComputedStyle(document.querySelector('.navbar-nav')).backgroundColor`);
    assert(/^rgb\(/.test(bg) || /, 1\)$/.test(bg), 'tab bar background is translucent: ' + bg);
  });

  t('no page errors during startup', async () => {
    await d().reload(9000);
    const errs = (await d().pageErrors()).filter(e => !/ERR_|Failed to load resource/.test(e));
    assert(errs.length === 0, 'page errors: ' + errs.slice(0, 3).join(' | '));
  });

  t('no native crash so far', async () => { assertEq(d().fatals(), '', 'crash log'); });
};
