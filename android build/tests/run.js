// Usage: node tests/run.js [suite ...] [--filter text] [--install] [--fresh]
//   suites: boot nav online streaming downloads offline settings lifecycle
const path = require('path');
const fs = require('fs');
const lib = require('./lib');

const args = process.argv.slice(2);
const fi = args.indexOf('--filter');
const filter = fi >= 0 ? args[fi + 1] : undefined;
const suites = args.filter((a, i) => !a.startsWith('--') && !(fi >= 0 && i === fi + 1));
const ALL = ['boot', 'nav', 'online', 'streaming', 'downloads', 'offline', 'settings', 'lifecycle'];
const wanted = suites.length ? suites : ALL;

(async () => {
  const ctx = { lib, d: null };
  ctx.d = await lib.Device.connect({ install: args.includes('--install'), fresh: args.includes('--fresh') });
  await lib.sleep(6000);
  for (const name of wanted) {
    const file = path.join(__dirname, 'suites', name + '.js');
    if (!fs.existsSync(file)) { console.log(`(no suite "${name}")`); continue; }
    require(file)(ctx);
  }
  const results = await lib.run({ filter });
  const fatals = ctx.d.fatals();
  if (fatals) console.log('\nNATIVE CRASH during the run:\n' + fatals);
  fs.writeFileSync(path.join(__dirname, 'last-results.json'), JSON.stringify(results, null, 2));
  process.exit(results.some(r => r.status === 'FAIL') || fatals ? 1 : 0);
})().catch(e => { console.error('Runner crashed:', e.message); process.exit(2); });
