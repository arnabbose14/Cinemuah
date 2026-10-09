const fs = require('fs');
const p = process.argv[2] + '/tests/probe.js';
let t = fs.readFileSync(p, 'utf8');
const old = "  // let it play 25s, then do what the test does\n  await sleep(25000);";
if (!t.includes(old)) throw new Error('marker');
t = t.replace(old, `  // exactly the test's actions: wait for first frames, pause, resume, skip forward 10s
  await sleep(8000);
  await d.ev("document.querySelector('.player-controls-overlay')?.classList.add('visible')");
  await d.tap('button[title="Play/Pause (Space)"]'); await sleep(900);
  console.log('after pause tap paused =', await d.ev("document.querySelector('video').paused"));
  await d.tap('button[title="Play/Pause (Space)"]'); await sleep(2500);
  console.log('after resume tap paused =', await d.ev("document.querySelector('video').paused"), '| video still mounted:', await d.ev("!!document.querySelector('video')"));
  const before = await d.ev("document.querySelector('video').currentTime");
  await d.tap('button[title^="Skip forward"]'); await sleep(4000);
  console.log('skip forward:', before, '->', await d.ev("document.querySelector('video') ? document.querySelector('video').currentTime : 'NO VIDEO'"));
  for (let i = 0; i < 12; i++) { await sleep(5000); const s = await d.ev("(() => { const v = document.querySelector('video'); return v ? 't=' + v.currentTime.toFixed(1) + ' ready=' + v.readyState + ' err=' + (v.error && v.error.code) : 'NO VIDEO: ' + document.querySelector('.player-overlay')?.innerText.slice(0, 60).replace(/\\\\n/g, ' '); })()"); console.log(' +' + (i + 1) * 5 + 's', s); if (/NO VIDEO/.test(s)) break; }
  await sleep(1000);`);
fs.writeFileSync(p, t);
console.log('probe extended');
