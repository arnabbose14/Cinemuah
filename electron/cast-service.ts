// Casting to TVs: Chromecast (CASTV2 via chromecast-api) and DLNA/UPnP renderers (SSDP + SOAP).
// The TV pulls the video from a small LAN-facing HTTP server that only exposes the one title being
// cast (behind a random token) by proxying the loopback media server. It is started on demand.
import http from 'http';
import os from 'os';
import crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ChromecastAPI = require('chromecast-api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client: SsdpClient } = require('node-ssdp');

export interface CastDevice { id: string; name: string; kind: 'chromecast' | 'dlna'; host: string }

export interface CastStartOptions {
  deviceId: string;
  /** Loopback media path without the leading slash, e.g. "media/12" or "torrent/<hash>/0". */
  target: string;
  title: string;
  start: number;
  /** WebVTT for the active captions (Chromecast only). */
  vtt?: string;
  captionLabel?: string;
}

export interface CastStatus {
  active: boolean;
  state: 'loading' | 'playing' | 'paused' | 'buffering' | 'idle' | 'ended';
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  deviceName: string;
  mode: 'direct' | 'transcode';
  error?: string;
}

interface DlnaInfo { avt: string; rc?: string }

interface Session {
  token: string;
  device: CastDevice;
  target: string;
  title: string;
  mode: 'direct' | 'transcode';
  offset: number;           // transcode mode: where the served stream starts
  duration: number;
  vtt?: string;
  base: string;             // http://<lan-ip>:<port>/c/<token>
  state: CastStatus['state'];
  devPos: number;           // last position reported by the device (relative to the served stream)
  devPosAt: number;
  volume: number;
  muted: boolean;
  error?: string;
  everPlayed: boolean;
  poll?: ReturnType<typeof setInterval>;
}

let localPort = 0;
let session: Session | null = null;
let castServer: http.Server | null = null;
let castPort = 0;

export function initCast(loopbackPort: number) { localPort = loopbackPort; }

// ─── Discovery ──────────────────────────────────────────────────────

const devices = new Map<string, CastDevice>();
const ccDevices = new Map<string, any>();
const dlnaInfo = new Map<string, DlnaInfo>();
let ccClient: any = null;
let ssdp: any = null;

const textOf = (xml: string, tag: string) => new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i').exec(xml)?.[1]?.trim() || '';

async function describeDlna(location: string) {
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(4000) });
    const xml = await res.text();
    const udn = textOf(xml, 'UDN');
    const name = textOf(xml, 'friendlyName');
    if (!udn || !name || !/MediaRenderer/i.test(xml)) return;
    const origin = new URL(location);
    const base = textOf(xml, 'URLBase') || `${origin.protocol}//${origin.host}`;
    const abs = (p: string) => new URL(p, base.endsWith('/') ? base : base + '/').toString();
    let avt = ''; let rc = '';
    for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
      const type = textOf(m[1], 'serviceType');
      const ctl = textOf(m[1], 'controlURL');
      if (/AVTransport/i.test(type) && ctl) avt = abs(ctl);
      if (/RenderingControl/i.test(type) && ctl) rc = abs(ctl);
    }
    if (!avt) return;
    const id = `dlna:${udn}`;
    dlnaInfo.set(id, { avt, rc: rc || undefined });
    devices.set(id, { id, name, kind: 'dlna', host: origin.hostname });
  } catch { /* device went away */ }
}

/** Starts (or refreshes) discovery and returns what has answered after a short wait. */
export async function discoverDevices(waitMs = 2500): Promise<CastDevice[]> {
  try {
    if (!ccClient) {
      ccClient = new ChromecastAPI();
      ccClient.on('device', (d: any) => {
        const id = `cc:${d.name}`;
        ccDevices.set(id, d);
        devices.set(id, { id, name: d.friendlyName || d.name, kind: 'chromecast', host: d.host });
      });
    } else {
      ccClient.update();
    }
  } catch (err) { console.error('[cast] chromecast discovery failed:', err); }

  try {
    if (!ssdp) {
      ssdp = new SsdpClient();
      ssdp.on('response', (headers: Record<string, string>) => { if (headers.LOCATION) describeDlna(headers.LOCATION); });
    }
    ssdp.search('urn:schemas-upnp-org:device:MediaRenderer:1');
  } catch (err) { console.error('[cast] dlna discovery failed:', err); }

  await new Promise(r => setTimeout(r, waitMs));
  return [...devices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ─── LAN-facing server ──────────────────────────────────────────────

function lanIpFor(host: string): string {
  const target = host.split('.').map(Number);
  let first = '';
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      first = first || ni.address;
      const mask = ni.netmask.split('.').map(Number);
      const mine = ni.address.split('.').map(Number);
      if (target.length === 4 && mine.every((b, i) => (b & mask[i]) === (target[i] & mask[i]))) return ni.address;
    }
  }
  return first || '127.0.0.1';
}

function features(mode: 'direct' | 'transcode') {
  // OP=01: byte seeking supported; 00: live-style stream
  return `DLNA.ORG_PN=AVC_MP4_BL_CIF15_AAC_520;DLNA.ORG_OP=${mode === 'direct' ? '01' : '00'};DLNA.ORG_CI=${mode === 'direct' ? '0' : '1'};DLNA.ORG_FLAGS=01700000000000000000000000000000`;
}

function ensureServer(): Promise<number> {
  if (castServer && castPort) return Promise.resolve(castPort);
  return new Promise((resolve, reject) => {
    castServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }

      const url = new URL(req.url || '/', 'http://x');
      const m = /^\/c\/([a-f0-9]{32})\/(video\.mp4|sub\.vtt)$/.exec(url.pathname);
      if (!m || !session || session.token !== m[1]) { res.writeHead(404); res.end(); return; }

      if (m[2] === 'sub.vtt') {
        if (!session.vtt) { res.writeHead(404); res.end(); return; }
        const body = Buffer.from(session.vtt, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      const mode = session.mode;
      const offset = Math.max(0, Math.floor(parseFloat(url.searchParams.get('o') || '0') || 0));
      const upstreamPath = mode === 'direct' ? `/${session.target}` : `/transcode/${session.target}?start=${offset}`;
      const headers: http.OutgoingHttpHeaders = {};
      if (req.headers.range && mode === 'direct') headers.range = req.headers.range;
      const up = http.request({ host: '127.0.0.1', port: localPort, path: upstreamPath, method: req.method, headers }, r => {
        res.writeHead(r.statusCode || 200, {
          ...r.headers,
          'Content-Type': 'video/mp4',
          'transferMode.dlna.org': 'Streaming',
          'contentFeatures.dlna.org': features(mode),
        });
        r.pipe(res);
      });
      up.on('error', () => res.destroy());
      res.on('close', () => up.destroy());
      up.end();
    });
    castServer.on('error', reject);
    castServer.listen(0, '0.0.0.0', () => {
      castPort = (castServer!.address() as { port: number }).port;
      resolve(castPort);
    });
  });
}

function stopServer() {
  castServer?.close();
  castServer?.closeAllConnections?.();
  castServer = null; castPort = 0;
}

// ─── DLNA / UPnP ────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function soap(url: string, service: 'AVTransport' | 'RenderingControl', action: string, args: Record<string, string | number>) {
  const urn = `urn:schemas-upnp-org:service:${service}:1`;
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${urn}">` +
    Object.entries(args).map(([k, v]) => `<${k}>${typeof v === 'string' ? v : v}</${k}>`).join('') +
    `</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${urn}#${action}"` },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(textOf(text, 'errorDescription') || `${action} failed (${res.status})`);
  return text;
}

const hms = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
const parseHms = (v: string) => {
  const m = /(\d+):(\d+):(\d+)/.exec(v || '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};

async function dlnaLoad(s: Session, startAt: number) {
  const info = dlnaInfo.get(s.device.id);
  if (!info) throw new Error('TV is no longer available');
  const url = `${s.base}/video.mp4?o=${Math.floor(s.mode === 'transcode' ? startAt : 0)}`;
  const didl = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">` +
    `<item id="0" parentID="-1" restricted="1"><dc:title>${esc(s.title)}</dc:title><upnp:class>object.item.videoItem.movie</upnp:class>` +
    `<res protocolInfo="http-get:*:video/mp4:${features(s.mode)}">${esc(url)}</res></item></DIDL-Lite>`;
  await soap(info.avt, 'AVTransport', 'Stop', { InstanceID: 0 }).catch(() => undefined);
  await soap(info.avt, 'AVTransport', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: esc(url), CurrentURIMetaData: esc(didl) });
  await soap(info.avt, 'AVTransport', 'Play', { InstanceID: 0, Speed: 1 });
  if (s.mode === 'direct' && startAt > 5) {
    // Many TVs ignore Seek until they are actually playing
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 700));
      const st = textOf(await soap(info.avt, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 }), 'CurrentTransportState');
      if (st === 'PLAYING') break;
    }
    await soap(info.avt, 'AVTransport', 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: hms(startAt) }).catch(() => undefined);
  }
}

async function dlnaPoll(s: Session) {
  const info = dlnaInfo.get(s.device.id);
  if (!info) throw new Error('TV is no longer available');
  const [ti, pi] = await Promise.all([
    soap(info.avt, 'AVTransport', 'GetTransportInfo', { InstanceID: 0 }),
    soap(info.avt, 'AVTransport', 'GetPositionInfo', { InstanceID: 0 }),
  ]);
  const st = textOf(ti, 'CurrentTransportState');
  const pos = parseHms(textOf(pi, 'RelTime'));
  const dur = parseHms(textOf(pi, 'TrackDuration'));
  if (dur > 0 && s.mode === 'direct') s.duration = dur;
  if (st === 'PLAYING') { s.state = 'playing'; s.everPlayed = true; }
  else if (st === 'PAUSED_PLAYBACK') { s.state = 'paused'; s.everPlayed = true; }
  else if (st === 'TRANSITIONING') s.state = 'buffering';
  else if (st === 'STOPPED' || st === 'NO_MEDIA_PRESENT') s.state = s.everPlayed ? 'ended' : 'loading';
  s.devPos = pos; s.devPosAt = Date.now();
  if (info.rc) {
    soap(info.rc, 'RenderingControl', 'GetVolume', { InstanceID: 0, Channel: 'Master' })
      .then(x => { const v = parseInt(textOf(x, 'CurrentVolume'), 10); if (!Number.isNaN(v)) s.volume = v / 100; })
      .catch(() => undefined);
  }
}

// ─── Chromecast ─────────────────────────────────────────────────────

const cc = <T = any>(fn: (cb: (err: Error | null, r?: T) => void) => void) =>
  new Promise<T>((resolve, reject) => fn((err, r) => (err ? reject(err) : resolve(r as T))));

function ccApply(s: Session, st: any) {
  if (!st) return;
  const state = st.playerState as string;
  if (state === 'PLAYING') { s.state = 'playing'; s.everPlayed = true; }
  else if (state === 'PAUSED') { s.state = 'paused'; s.everPlayed = true; }
  else if (state === 'BUFFERING') s.state = 'buffering';
  else if (state === 'IDLE') s.state = st.idleReason === 'FINISHED' ? 'ended' : s.everPlayed ? 'idle' : 'loading';
  if (typeof st.currentTime === 'number') { s.devPos = st.currentTime; s.devPosAt = Date.now(); }
  if (st.media?.duration && s.mode === 'direct') s.duration = st.media.duration;
}

async function ccLoad(s: Session, startAt: number) {
  const dev = ccDevices.get(s.device.id);
  if (!dev) throw new Error('Chromecast is no longer available');
  const media: Record<string, unknown> = {
    url: `${s.base}/video.mp4?o=${Math.floor(s.mode === 'transcode' ? startAt : 0)}`,
    contentType: 'video/mp4',
    cover: { title: s.title, url: '' },
  };
  if (s.vtt) media.subtitles = [{ language: 'en', url: `${s.base}/sub.vtt`, name: 'Captions' }];
  const opts = { startTime: s.mode === 'direct' ? startAt : 0 };
  const status = await cc(cb => dev.play(media, opts, cb));
  ccApply(s, status);
  dev.removeAllListeners('status');
  dev.on('status', (st: any) => { if (session === s) ccApply(s, st); });
}

async function ccPoll(s: Session) {
  const dev = ccDevices.get(s.device.id);
  if (!dev) throw new Error('Chromecast is no longer available');
  ccApply(s, await cc(cb => dev.getStatus(cb)));
  dev.getVolume((err: Error | null, v: any) => { if (!err && v) { s.volume = v.level ?? s.volume; s.muted = !!v.muted; } });
}

// ─── Session control ────────────────────────────────────────────────

async function probeLocal(target: string): Promise<{ duration: number; direct: boolean; video: string; audio: string; container: string }> {
  const res = await fetch(`http://127.0.0.1:${localPort}/info/${target}`, { signal: AbortSignal.timeout(35000) });
  if (!res.ok) throw new Error('This title is not ready to cast yet');
  return res.json() as any;
}

/** TVs are fussier than Chromium: only plain H.264 + AAC/MP3/AC3 in an MP4 is sent as-is. */
const tvDirect = (i: { video: string; audio: string; container: string }) =>
  i.video === 'h264' && (!i.audio || ['aac', 'mp3', 'ac3'].includes(i.audio)) && /mp4|mov/.test(i.container);

export async function startCast(opts: CastStartOptions): Promise<{ mode: 'direct' | 'transcode'; duration: number; deviceName: string }> {
  const device = devices.get(opts.deviceId);
  if (!device) throw new Error('That TV is no longer available. Search again.');
  if (!/^(media\/\d+|torrent\/[0-9a-fA-F]{40}\/\d+)$/.test(opts.target)) throw new Error('Nothing to cast');
  await stopCast().catch(() => undefined);

  const info = await probeLocal(opts.target);
  const port = await ensureServer();
  const token = crypto.randomBytes(16).toString('hex');
  const s: Session = {
    token, device, target: opts.target, title: opts.title,
    mode: tvDirect(info) ? 'direct' : 'transcode',
    offset: 0, duration: info.duration || 0,
    vtt: opts.vtt,
    base: `http://${lanIpFor(device.host)}:${port}/c/${token}`,
    state: 'loading', devPos: 0, devPosAt: Date.now(), volume: 0.5, muted: false, everPlayed: false,
  };
  s.offset = s.mode === 'transcode' ? Math.max(0, opts.start) : 0;
  session = s;

  try {
    if (device.kind === 'dlna') await dlnaLoad(s, opts.start); else await ccLoad(s, opts.start);
  } catch (err) {
    session = null;
    stopServer();
    throw err;
  }

  s.poll = setInterval(() => {
    if (session !== s) return;
    (device.kind === 'dlna' ? dlnaPoll(s) : ccPoll(s)).then(() => { s.error = undefined; }).catch(e => { s.error = e instanceof Error ? e.message : String(e); });
  }, 1500);
  return { mode: s.mode, duration: s.duration, deviceName: device.name };
}

export function castStatus(): CastStatus {
  const s = session;
  if (!s) return { active: false, state: 'idle', position: 0, duration: 0, volume: 0, muted: false, deviceName: '', mode: 'direct' };
  const live = s.state === 'playing' ? (Date.now() - s.devPosAt) / 1000 : 0;
  return {
    active: true, state: s.state,
    position: (s.mode === 'transcode' ? s.offset : 0) + s.devPos + live,
    duration: s.duration, volume: s.volume, muted: s.muted,
    deviceName: s.device.name, mode: s.mode, error: s.error,
  };
}

export async function castControl(action: 'play' | 'pause' | 'seek' | 'volume' | 'mute' | 'stop', value?: number): Promise<void> {
  const s = session;
  if (!s) return;
  const dlna = s.device.kind === 'dlna';
  const dev = dlna ? null : ccDevices.get(s.device.id);
  const info = dlna ? dlnaInfo.get(s.device.id) : undefined;

  switch (action) {
    case 'play':
      if (dlna) await soap(info!.avt, 'AVTransport', 'Play', { InstanceID: 0, Speed: 1 }); else await cc(cb => dev.unpause(cb));
      s.state = 'playing'; s.devPosAt = Date.now();
      break;
    case 'pause':
      if (dlna) await soap(info!.avt, 'AVTransport', 'Pause', { InstanceID: 0 }); else await cc(cb => dev.pause(cb));
      s.devPos += (Date.now() - s.devPosAt) / 1000; s.devPosAt = Date.now(); s.state = 'paused';
      break;
    case 'seek': {
      const t = Math.max(0, Math.min(value ?? 0, s.duration > 2 ? s.duration - 2 : value ?? 0));
      if (s.mode === 'transcode') {
        // The transcoded stream can't be sought: restart it at the new position
        s.offset = t; s.devPos = 0; s.devPosAt = Date.now(); s.state = 'loading'; s.everPlayed = false;
        if (dlna) await dlnaLoad(s, t); else await ccLoad(s, t);
      } else {
        if (dlna) await soap(info!.avt, 'AVTransport', 'Seek', { InstanceID: 0, Unit: 'REL_TIME', Target: hms(t) });
        else await cc(cb => dev.seekTo(t, cb));
        s.devPos = t; s.devPosAt = Date.now();
      }
      break;
    }
    case 'volume': {
      const v = Math.max(0, Math.min(1, value ?? 0));
      if (dlna) { if (info?.rc) await soap(info.rc, 'RenderingControl', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: Math.round(v * 100) }); }
      else await cc(cb => dev.setVolume(v, cb));
      s.volume = v;
      break;
    }
    case 'mute': {
      const muted = !s.muted;
      if (dlna) { if (info?.rc) await soap(info.rc, 'RenderingControl', 'SetMute', { InstanceID: 0, Channel: 'Master', DesiredMute: muted ? 1 : 0 }); }
      else await cc(cb => dev.setVolumeMuted(muted, cb));
      s.muted = muted;
      break;
    }
    case 'stop':
      await stopCast();
      break;
  }
}

export async function stopCast(): Promise<void> {
  const s = session;
  if (!s) return;
  session = null;
  if (s.poll) clearInterval(s.poll);
  try {
    if (s.device.kind === 'dlna') {
      const info = dlnaInfo.get(s.device.id);
      if (info) await soap(info.avt, 'AVTransport', 'Stop', { InstanceID: 0 });
    } else {
      const dev = ccDevices.get(s.device.id);
      if (dev) { dev.removeAllListeners('status'); await cc(cb => dev.stop(cb)); dev.close?.(); }
    }
  } catch { /* the TV may already be gone */ }
  stopServer();
}

export function shutdownCast() {
  stopCast().catch(() => undefined);
  try { ccClient?.destroy(); } catch { /* ignore */ }
  try { ssdp?.stop(); } catch { /* ignore */ }
}
