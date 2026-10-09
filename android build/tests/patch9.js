const fs = require('fs');
const p = process.argv[2] + '/shim/electron-shim.ts';
let t = fs.readFileSync(p, 'utf8');
const old = "      fsElement = null;\n      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));\n      return;";
if (!t.includes(old)) throw new Error('back handler block not found');
t = t.replace(old, `      fsElement = null;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      // On the "Playback Error" screen the <video> is gone, so the player ignores Escape: use its own Back button
      setTimeout(() => {
        const overlay = document.querySelector('.player-overlay');
        if (!overlay) return;
        const buttons = Array.from(overlay.querySelectorAll<HTMLElement>('button'));
        const back = buttons.find(b => /back/i.test(b.textContent || '')) || buttons.find(b => /^close/i.test(b.title || '')) || buttons[0];
        back?.click();
      }, 250);
      return;`);
fs.writeFileSync(p, t);
console.log('back handler patched');
