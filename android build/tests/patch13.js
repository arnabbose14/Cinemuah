const fs = require('fs');
for (const p of process.argv.slice(2)) {
  let t = fs.readFileSync(p, 'utf8');
  const n = (t.match(/'-c:v', 'libx264',/g) || []).length;
  t = t.split("'-c:v', 'libx264',").join("'-c:v', 'libx264', '-pix_fmt', 'yuv420p',");   // Android decoders reject H.264 4:4:4
  fs.writeFileSync(p, t);
  console.log(p.split(/[\\/]/).pop(), '->', n, 'recipes now 4:2:0');
}
