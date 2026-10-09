const fs = require('fs');
for (const p of process.argv.slice(2)) {
  let t = fs.readFileSync(p, 'utf8');
  const before = t;
  // CBR 4 Mbit/s for 60s = ~30 MB regardless of content (the old noise+CRF version produced 3.3 GB)
  t = t.replace(/\['-f', 'lavfi', '-i', 'testsrc2=duration=90:size=1920x1080:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=90', '-vf', 'noise=alls=35:allf=t', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-g', '48', '-c:a', 'aac', '-movflags', '\+faststart', f\]/,
    "['-f', 'lavfi', '-i', 'testsrc2=duration=60:size=1280x720:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=60', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-minrate', '4M', '-maxrate', '4M', '-bufsize', '8M', '-g', '48', '-c:a', 'aac', '-movflags', '+faststart', f]");
  if (t === before) throw new Error('fixture recipe not found in ' + p);
  fs.writeFileSync(p, t);
}
console.log('recipes updated');
