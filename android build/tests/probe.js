const { Device, sleep, adb } = require('./lib');
(async () => {
  const d = await Device.connect();
  console.log('overlay:', await d.ev(`!!document.querySelector('.player-overlay')`));
  console.log('video:', JSON.stringify(await d.ev(`(() => { const v = document.querySelector('video'); return v ? { src: v.currentSrc, ready: v.readyState, net: v.networkState, err: v.error && (v.error.code + ': ' + v.error.message), dur: v.duration, t: v.currentTime, paused: v.paused, w: v.videoWidth } : null; })()`)));
  console.log('overlay text:', await d.ev(`document.querySelector('.player-overlay')?.innerText.slice(0, 150).replace(/\\n/g, ' | ')`));
  const item = (await d.ev('window.electronAPI.movies.getAll()'))[0];
  const port = await d.ev('window.electronAPI.media.getPort()');
  console.log('item:', item.id, item.fileName, item.fileSize);
  const r = await d.ev(`fetch('http://127.0.0.1:${port}/media/${item.id}', { headers: { Range: 'bytes=0-15' } }).then(async r => ({ s: r.status, cr: r.headers.get('content-range'), ct: r.headers.get('content-type'), n: (await r.arrayBuffer()).byteLength })).catch(e => String(e))`);
  console.log('manual range fetch:', JSON.stringify(r));
  const info = await d.ev(`fetch('http://127.0.0.1:${port}/info/media/${item.id}').then(r => r.text())`);
  console.log('/info:', info);
  console.log('logcat chromium media errors:', adb('logcat', '-d').out.split('\n').filter(l => /chromium.*(media|Media|ERROR)|StreamServer|NanoHTTPD/i.test(l)).slice(-6).join('\n'));
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
