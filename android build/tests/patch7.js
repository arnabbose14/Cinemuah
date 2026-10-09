const fs = require('fs');
let p = process.argv[2] + '/android/app/src/main/java/com/cinemuah/app/StreamServer.java', t = fs.readFileSync(p, 'utf8');
const old = `            Response r = newFixedLengthResponse(partial ? Response.Status.PARTIAL_CONTENT : Response.Status.OK, mime, "");
            r.addHeader("Content-Length", String.valueOf(length));
            if (partial) r.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
            return cors(r);`;
if (!t.includes(old)) throw new Error('HEAD block not found');
t = t.replace(old, `            // NanoHTTPD derives Content-Length from the declared size and sends no body for HEAD
            Response r = newFixedLengthResponse(partial ? Response.Status.PARTIAL_CONTENT : Response.Status.OK, mime,
                    new ByteArrayInputStream(new byte[0]), length);
            if (partial) r.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
            return cors(r);`);
fs.writeFileSync(p, t);
p = process.argv[2] + '/tests/suites/streaming.js'; t = fs.readFileSync(p, 'utf8');
const old2 = "    await startLocal(s); await sleep(3000);\n    assert(Number(streamFiles()) >= 1, 'no stream cache created');";
if (!t.includes(old2)) throw new Error('cache test block not found');
t = t.replace(old2, "    await startLocal(s);\n    await d().waitFor(`true`, { timeout: 1000 });\n    const t0 = Date.now(); while (Number(streamFiles()) < 1 && Date.now() - t0 < 30000) await sleep(1000);   // peers connect after ~8s\n    assert(Number(streamFiles()) >= 1, 'no stream cache created');");
fs.writeFileSync(p, t);
console.log('patched');
