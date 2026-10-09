// Networking helpers for hosts that ISPs block with DNS poisoning.
// Names are resolved over DNS-over-HTTPS (Cloudflare) and the real IP is connected to directly,
// with the original host name kept for TLS (SNI) and the Host header.
import https from 'https';

const dohCache = new Map<string, { ips: string[]; expires: number }>();

export async function resolveDoh(host: string): Promise<string[]> {
  const hit = dohCache.get(host);
  if (hit && hit.expires > Date.now()) return hit.ips;
  const res = await fetch(`https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=A`, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(5000),
  });
  const json: any = await res.json();
  const ips: string[] = (json.Answer || []).filter((a: any) => a.type === 1).map((a: any) => a.data);
  if (ips.length === 0) throw new Error(`DNS lookup failed for ${host}`);
  dohCache.set(host, { ips, expires: Date.now() + 10 * 60 * 1000 });
  return ips;
}

export interface ViaIpResponse { status: number; type: string; body: Buffer }

interface ViaIpOptions {
  headers?: Record<string, string>;
  /** Resolve with non-200 statuses too (the caller decides what a 404 means). */
  anyStatus?: boolean;
  /** Host names redirects may follow to (default: none). */
  allowHost?: (host: string) => boolean;
  redirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

/** GET `urlStr` by connecting to `ip` directly. Only 200 responses resolve. */
export function getViaIp(urlStr: string, ip: string, opts: ViaIpOptions = {}): Promise<ViaIpResponse> {
  const { allowHost, redirects = 3, maxBytes = 10 * 1024 * 1024, timeoutMs = 10000 } = opts;
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: ip, port: 443, path: url.pathname + url.search, method: 'GET',
      servername: url.hostname, headers: { Host: url.hostname, 'User-Agent': 'CineLocal/1.0', Accept: '*/*', ...(opts.headers || {}) },
      timeout: timeoutMs,
    }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, urlStr);
        if (!allowHost || !allowHost(next.hostname)) return reject(new Error('Redirect to disallowed host'));
        resolveDoh(next.hostname)
          .then(ips => getViaIp(next.toString(), ips[0], { ...opts, redirects: redirects - 1 }))
          .then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200 && !opts.anyStatus) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(new Error('Response too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        status: res.statusCode || 200,
        type: String(res.headers['content-type'] || ''),
        body: Buffer.concat(chunks),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('Timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** JSON over DNS-over-HTTPS; tries each resolved IP in turn. */
export async function getJsonViaDoh(urlStr: string, timeoutMs = 10000): Promise<any> {
  const url = new URL(urlStr);
  const ips = await resolveDoh(url.hostname);
  let lastError: unknown = null;
  for (const ip of ips) {
    try {
      const { body } = await getViaIp(urlStr, ip, { timeoutMs });
      return JSON.parse(body.toString('utf8'));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

const NETWORK_CODES = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|UND_ERR_CONNECT_TIMEOUT/;
const isNetworkFailure = (err: unknown) => {
  const e = err as { cause?: { code?: string }; code?: string; message?: string } | undefined;
  return NETWORK_CODES.test(e?.cause?.code || e?.code || '') || /fetch failed/i.test(e?.message || '');
};

/**
 * fetch() that survives flaky or poisoned DNS: when the normal lookup or connection fails it asks Cloudflare
 * (DNS-over-HTTPS) for the address and connects to that directly. HTTPS GET only.
 */
export async function resilientFetch(urlStr: string, init: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? 15000;
  try {
    return await fetch(urlStr, { headers: init.headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:' || !isNetworkFailure(err)) throw err;
    const ips = await resolveDoh(url.hostname);
    let last: unknown = err;
    for (const ip of ips) {
      try {
        const r = await getViaIp(urlStr, ip, { headers: init.headers, timeoutMs, anyStatus: true, allowHost: () => true });
        return new Response(new Uint8Array(r.body), { status: r.status, headers: { 'content-type': r.type } });
      } catch (e) { last = e; }
    }
    throw last instanceof Error ? last : err;
  }
}
