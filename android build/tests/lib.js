// Android end-to-end harness: drives the real APK in the emulator through adb + the WebView's DevTools socket.
// Usage: node tests/run.js [suite ...]   (the emulator must be running; see tests/README.md)
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = process.env.USERPROFILE;
const TOOLS = path.join(HOME, 'android-tools');
const ADB = path.join(TOOLS, 'sdk', 'platform-tools', 'adb.exe');
const PROJ = path.resolve(__dirname, '..');
const ROOT = path.resolve(PROJ, '..');
const PKG = 'com.cinemuah.app';
const SHOTS = path.join(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function adb(...args) {
  const r = spawnSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), code: r.status };
}
const sh = cmd => adb('shell', cmd).out;

const IGNORED_CONSOLE = [/Capacitor\//i, /Autofill/i, /Third-party cookie/i];

class Device {
  constructor() { this.errors = []; this.pending = new Map(); this.id = 0; this.fwPort = 9333; }

  // â”€â”€ lifecycle â”€â”€
  static async connect({ install = false, fresh = false } = {}) {
    const d = new Device();
    const devices = adb('devices').out;
    if (!/emulator-\d+\s+device/.test(devices)) throw new Error('No emulator running. Start it first (see tests/README.md).\n' + devices);
    if (install) {
      const apk = path.join(PROJ, 'Cinemuah-debug.apk');
      const r = adb('install', '-r', '-g', apk);
      if (!/Success/.test(r.out + r.err)) throw new Error('install failed: ' + r.out + r.err);
    }
    if (fresh) { adb('shell', 'pm', 'clear', PKG); }
    await d.launch();
    return d;
  }

  async launch() {
    adb('logcat', '-c');
    adb('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
    await this.attach();
  }

  async attach() {
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const pid = sh(`pidof ${PKG}`);
      if (pid) {
        const sockets = sh('cat /proc/net/unix');
        const m = new RegExp(`@(webview_devtools_remote_${pid.split(/\s+/)[0]})`).exec(sockets);
        if (m) {
          adb('forward', `tcp:${this.fwPort}`, `localabstract:${m[1]}`);
          try {
            const list = await (await fetch(`http://127.0.0.1:${this.fwPort}/json/list`)).json();
            const target = list.find(t => t.type === 'page');
            if (target) { await this.open(target.webSocketDebuggerUrl); return; }
          } catch { /* retry */ }
        }
      }
      await sleep(500);
    }
    throw new Error('Could not attach to the app WebView (is the debug APK installed?)');
  }

  async open(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); return; }
      if (d.method) this.onEvent(d);
    };
    await this.send('Runtime.enable'); await this.send('Log.enable'); await this.send('Page.enable');
    // Record console.error / uncaught errors with their real contents (and across reloads)
    const hook = `
      if (!window.__errs) { window.__errs = []; const orig = console.error;
        console.error = (...a) => { try { window.__errs.push(a.map(x => x instanceof Error ? (x.stack || x.message) : (typeof x === 'object' && x ? JSON.stringify(x, Object.getOwnPropertyNames(x)) : String(x))).join(' ')); } catch (e) { window.__errs.push('unserialisable'); } orig.apply(console, a); };
        window.addEventListener('error', e => window.__errs.push('window.error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
        window.addEventListener('unhandledrejection', e => window.__errs.push('unhandledrejection: ' + (e.reason && (e.reason.message || JSON.stringify(e.reason))))); }`;
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: hook });
    await this.send('Runtime.evaluate', { expression: hook });
  }
  /** Errors the page logged since the last call (clears the list). */
  async pageErrors() { return this.ev(`(() => { const e = window.__errs || []; window.__errs = []; return e; })()`); }

  onEvent(d) {
    if (d.method === 'Runtime.exceptionThrown') {
      const e = d.params.exceptionDetails;
      this.errors.push({ kind: 'exception', text: (e.exception && e.exception.description) || e.text });
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 60000);
      this.pending.set(id, d => { clearTimeout(timer); d.error ? reject(new Error(d.error.message)) : resolve(d.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }

  async waitFor(expression, { timeout = 15000, interval = 300, message } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try { last = await this.ev(expression); if (last) return last; } catch (e) { last = e.message; }
      await sleep(interval);
    }
    throw new Error(`Timed out (${timeout}ms) waiting for: ${message || expression}${last ? ' (last: ' + String(last).slice(0, 140) + ')' : ''}`);
  }

  // â”€â”€ interaction (JS-level and real touch) â”€â”€
  async clickText(selector, text) {
    const ok = await this.ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`No "${selector}" with text "${text}"`);
  }
  async click(selector, index = 0) {
    const ok = await this.ev(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`No element ${selector}[${index}]`);
  }
  async count(selector) { return this.ev(`document.querySelectorAll(${JSON.stringify(selector)}).length`); }
  async texts(selector, limit = 60) { return this.ev(`[...document.querySelectorAll(${JSON.stringify(selector)})].slice(0, ${limit}).map(e => e.textContent.trim())`); }
  async exists(selector) { return this.ev(`!!document.querySelector(${JSON.stringify(selector)})`); }
  async type(selector, value) {
    await this.ev(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); if (!i) throw new Error('no input'); i.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(value)});
      i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  async select(selector, value, index = 0) {
    await this.ev(`(() => { const s = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!s) throw new Error('no select');
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, ${JSON.stringify(String(value))});
      s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }
  /** Touch tap on an element (DevTools touch events: full touch -> click pipeline, page coordinates). */
  async tap(selector, index = 0) {
    await this.ev(`document.querySelectorAll(${JSON.stringify(selector)})[${index}]?.scrollIntoView({ block: 'center' })`);
    await sleep(250);
    const b = await this.ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!b) throw new Error('tap: not found ' + selector);
    try {
      await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
      await sleep(60);
      await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } catch (e) { await this.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {}); throw e; }
    await sleep(350);
  }
  /** Offset between page coordinates and screen pixels (status bar), measured once with a real tap. */
  async screenOffset() {
    if (this._off) return this._off;
    // A full-screen transparent overlay catches the calibration tap so it cannot activate anything underneath
    await this.ev(`(() => { const o = document.createElement('div'); o.id = '__calib'; o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent';
      o.addEventListener('pointerdown', e => { window.__probe = { x: e.clientX, y: e.clientY }; }, true); document.body.appendChild(o); window.__probe = null; })()`);
    adb('shell', 'input', 'tap', '540', '1000'); await sleep(600);
    const p = await this.ev('window.__probe');
    await this.ev(`document.getElementById('__calib')?.remove()`);
    if (!p) throw new Error('screen calibration tap was not received');
    const dpr = await this.ev('window.devicePixelRatio');
    this._off = { dx: 540 - p.x * dpr, dy: 1000 - p.y * dpr, dpr };
    return this._off;
  }
  /** Finger swipe in page (CSS px) coordinates, injected by the OS like a real finger. */
  async swipe(x1, y1, x2, y2, ms = 280) {
    const o = await this.screenOffset();
    const s = v => String(Math.round(v));
    adb('shell', 'input', 'swipe', s(x1 * o.dpr + o.dx), s(y1 * o.dpr + o.dy), s(x2 * o.dpr + o.dx), s(y2 * o.dpr + o.dy), String(ms));
    await sleep(ms + 700);
  }
  /** Scroll the page down like a flick of the thumb. */
  async flick() { return this.swipe(200, 700, 200, 150); }
  setAirplane(on) { adb('shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable'); return sleep(on ? 3000 : 6000); }
  /** Re-launch and re-attach if a previous test left the app (e.g. Back on Home exits it). */
  async ensure() {
    const alive = this.pid() && this.ws && this.ws.readyState === 1;
    if (alive) { try { await this.ev('1'); return; } catch { /* fall through */ } }
    await this.launch(); await sleep(6000);
  }
  /** Close a player or dialog a previous (failed) test left open, so the next test starts clean. */
  async cleanSlate() {
    await this.ensure();
    // a stalled stream or download from an earlier test would hog the emulator's bandwidth for every test after it
    await this.ev(`window.electronAPI.torrent.stop().then(() => window.electronAPI.downloads.list()).then(l => Promise.all(l.map(x => window.electronAPI.downloads.cancel(x.infoHash))))`).catch(() => {});
    for (let i = 0; i < 3; i++) {
      const open = await this.ev(`!!document.querySelector('.player-overlay, .movie-detail-overlay')`).catch(() => false);
      if (!open) break;
      await this.back(); await sleep(900);
    }
  }
  back() { adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); return sleep(600); }
  async key(key) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 0 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  }

  // â”€â”€ device helpers â”€â”€
  async shot(name) {
    fs.mkdirSync(SHOTS, { recursive: true });
    adb('shell', 'screencap', '-p', '/sdcard/cm.png');
    const file = path.join(SHOTS, name + '.png');
    adb('pull', '/sdcard/cm.png', file);
    return file;
  }
  logcat(filter = '') { return adb('logcat', '-d', ...(filter ? filter.split(' ') : [])).out; }
  fatals() {
    const log = adb('logcat', '-d', '-b', 'crash').out + '\n' + adb('logcat', '-d', '-s', 'AndroidRuntime:E').out;
    return /FATAL EXCEPTION|Fatal signal|ANR in/.test(log) ? log.split('\n').filter(l => /FATAL|Exception|Fatal|ANR|at com\.cinemuah/.test(l)).slice(0, 12).join('\n') : '';
  }
  pid() { return sh(`pidof ${PKG}`); }
  setRotation(n) { adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0'); adb('shell', 'settings', 'put', 'system', 'user_rotation', String(n)); return sleep(1500); }
  async resetPrefs() { await this.ev('localStorage.clear()'); }
  async reload(wait = 6000) { await this.send('Page.reload'); await sleep(wait); }
  async setMode(mode) {
    const active = await this.ev(`document.querySelector('.mode-switch-btn.active')?.getAttribute('title')?.toLowerCase().startsWith('online') ? 'online' : 'offline'`);
    if (active !== mode) { await this.click(`.mode-switch-btn[title^="${mode === 'online' ? 'Online' : 'Offline'}"]`); await sleep(1500); }
  }
  async nav(label) { await this.clickText('.navbar-nav .nav-link', label); await sleep(700); }
  async page() { return this.ev(`document.querySelector('.navbar-nav .nav-link.active')?.textContent || null`); }
  clearErrors() { const e = this.errors; this.errors = []; return e; }
}

// â”€â”€ local torrent seeder reachable from the emulator at 10.0.2.2 â”€â”€
async function startSeeder(file, { port, uploadLimit } = {}) {
  const script = `
    const { pathToFileURL } = require('url');
    (async () => {
      const mod = await new Function('s', 'return import(s)')(pathToFileURL(${JSON.stringify(path.join(ROOT, 'node_modules', 'webtorrent', 'index.js'))}).href);
      const c = new mod.default({ dht: false, lsd: false, utp: false, torrentPort: ${port}, ${uploadLimit ? 'uploadLimit: ' + uploadLimit + ',' : ''} });
      c.seed(${JSON.stringify(file)}, { announce: [] }, t => console.log('HASH ' + t.infoHash));
    })();`;
  const scriptFile = path.join(os.tmpdir(), `seeder-${port}.js`);
  fs.writeFileSync(scriptFile, script);
  const proc = spawn(process.execPath, [scriptFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  const hash = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('seeder timeout')), 20000);
    proc.stdout.on('data', d => { const m = /HASH ([0-9a-f]{40})/.exec(String(d)); if (m) { clearTimeout(t); resolve(m[1]); } });
    proc.on('exit', () => reject(new Error('seeder exited')));
  });
  return { hash, magnet: `magnet:?xt=urn:btih:${hash}&x.pe=10.0.2.2:${port}`, stop: () => spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }) };
}

function ffmpegPath() { return require(path.join(ROOT, 'node_modules', 'ffmpeg-static')); }
function ffmpeg(args) {
  const r = spawnSync(ffmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + (r.stderr || '').slice(0, 300));
}

// â”€â”€ runner â”€â”€
const registry = [];
function test(name, fn, opts = {}) { registry.push({ name, fn, ...opts }); }
async function run({ filter } = {}) {
  const results = [];
  for (const t of registry) {
    if (filter && !t.name.toLowerCase().includes(filter.toLowerCase())) continue;
    const started = Date.now();
    let status = 'PASS', detail = '';
    try {
      await Promise.race([t.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`test timeout (${(t.timeout || 90000) / 1000}s)`)), t.timeout || 90000))]);
    } catch (e) { status = 'FAIL'; detail = e.message; }
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.push({ name: t.name, group: t.group, status, secs, detail });
    console.log(`${status === 'PASS' ? ' PASS' : ' FAIL'}  [${t.group || '-'}] ${t.name} (${secs}s)${detail ? '\n        -> ' + detail : ''}`);
  }
  const failed = results.filter(r => r.status === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `, ${failed.length} FAILED` : ''}`);
  return results;
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const assertEq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };

module.exports = { Device, adb, sh, startSeeder, ffmpeg, test, run, assert, assertEq, sleep, PROJ, ROOT, PKG, SHOTS };
