const fs = require('fs');
const p = process.argv[2] + '/shim/electron-shim.ts';
let t = fs.readFileSync(p, 'utf8');
const old = "  CapApp.addListener('backButton', () => {\n";
if (!t.includes(old)) throw new Error('listener not found');
t = t.replace(old, "  CapApp.addListener('backButton', () => {\n    console.log('[cm] hardware Back; player=' + !!document.querySelector('.player-overlay') + ' dialog=' + !!document.querySelector('.movie-detail-overlay'));\n");
fs.writeFileSync(p, t);
console.log('log added');
