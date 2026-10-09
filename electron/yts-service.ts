// YTS (yts.mx) API client — browse/search movies and build magnet links.

import { resolveDoh, getViaIp } from './net-util';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

// Mirrors are tried in order; YTS domains are frequently blocked or rotated.
// movies-api.accel.li is the official API base YTS announced after yts.mx/.lt/.am moved.
const API_HOSTS = ['https://movies-api.accel.li', 'https://yts.gg', 'https://yts.mx', 'https://yts.lt', 'https://yts.am', 'https://yts.rs'];
let lastGoodHost = '';

const TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.coppersurfer.tk:6969',
  'udp://glotorrents.pw:6969/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://torrent.gresille.org:80/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.leechers-paradise.org:6969',
  'udp://exodus.desync.com:6969/announce',
  'wss://tracker.openwebtorrent.com',
];

export interface YtsTorrent {
  quality: string; // 720p, 1080p, 2160p
  type: string; // bluray, web
  videoCodec: string;
  size: string;
  sizeBytes: number;
  seeds: number;
  peers: number;
  hash: string;
  magnet: string;
}

export interface YtsMovie {
  id: number;
  imdbCode: string;
  title: string;
  year: number;
  rating: number;
  runtime: number;
  genres: string[];
  summary: string;
  language: string;
  poster: string;
  backdrop: string;
  trailerCode: string;
  torrents: YtsTorrent[];
}

export interface YtsListOptions {
  query?: string;
  page?: number;
  limit?: number;
  genre?: string;
  quality?: string;
  sortBy?: string; // title, year, rating, peers, seeds, download_count, like_count, date_added
  minimumRating?: number;
}

export interface YtsListResult {
  movies: YtsMovie[];
  total: number;
  page: number;
  limit: number;
}

// ─── Image proxy ────────────────────────────────────────────────────────────────────────
// Some ISPs poison DNS for these domains, so images are fetched by resolving the host over
// DNS-over-HTTPS and connecting to the real IP (see net-util.ts). Used for YTS and TVMaze artwork.

const IMAGE_HOST_RE = /^(?:[a-z0-9-]+\.)*(?:yts\.[a-z]+|accel\.li|tvmaze\.com)$/i;
const imageCache = new Map<string, { type: string; body: Buffer }>();

/** Fetches an image from a YTS-related host, bypassing poisoned system DNS. */
export async function fetchYtsImage(urlStr: string): Promise<{ type: string; body: Buffer }> {
  const url = new URL(urlStr);
  if (url.protocol !== 'https:' || !IMAGE_HOST_RE.test(url.hostname)) throw new Error('Host not allowed');
  const cached = imageCache.get(urlStr);
  if (cached) return cached;

  // Disk cache: posters are downloaded once and reused across launches.
  const file = path.join(imageDir(), crypto.createHash('sha1').update(urlStr).digest('hex'));
  try {
    const body = fs.readFileSync(file);
    const result = { type: sniffImageType(body), body };
    rememberImage(urlStr, result);
    return result;
  } catch { /* not cached yet */ }

  const ips = await resolveDoh(url.hostname);
  const { body, type } = await getViaIp(urlStr, ips[0], { allowHost: h => IMAGE_HOST_RE.test(h), timeoutMs: 8000 });
  const result = { type: type || sniffImageType(body), body };
  rememberImage(urlStr, result);
  try { fs.writeFileSync(file, result.body); } catch { /* cache is best effort */ }
  return result;
}

function rememberImage(key: string, value: { type: string; body: Buffer }) {
  if (imageCache.size >= 200) imageCache.delete(imageCache.keys().next().value as string);
  imageCache.set(key, value);
}

function sniffImageType(body: Buffer): string {
  if (body[0] === 0x89 && body[1] === 0x50) return 'image/png';
  if (body[0] === 0x52 && body[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}

function imageDir(): string {
  const dir = path.join(app.getPath('userData'), 'yts-images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Listing cache ──────────────────────────────────────────────────
// Listings are cached on disk so Discover opens instantly (even offline) and is refreshed in the background.

const LIST_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_LISTS = 60;
type ListCache = Record<string, { time: number; result: YtsListResult }>;
let listCache: ListCache | null = null;
let listCacheTimer: NodeJS.Timeout | null = null;

function listCacheFile(): string {
  return path.join(app.getPath('userData'), 'yts-cache.json');
}

function getListCache(): ListCache {
  if (listCache) return listCache;
  try { listCache = JSON.parse(fs.readFileSync(listCacheFile(), 'utf8')); } catch { listCache = {}; }
  return listCache!;
}

function saveListCache() {
  if (listCacheTimer) return;
  listCacheTimer = setTimeout(() => {
    listCacheTimer = null;
    const cache = getListCache();
    const keys = Object.keys(cache).sort((a, b) => cache[b].time - cache[a].time);
    keys.slice(MAX_CACHED_LISTS).forEach(k => delete cache[k]);
    // stringify is the expensive part; the write itself is async so the main process never stalls on disk
    let json = '';
    try { json = JSON.stringify(cache); } catch { return; }
    fs.promises.writeFile(listCacheFile(), json).catch(() => undefined);
  }, 5000);
}

function cacheKey(o: YtsListOptions): string {
  return JSON.stringify([
    (o.query || '').trim().toLowerCase(), o.page || 1, o.limit || 24,
    o.genre && o.genre !== 'all' ? o.genre : '', o.quality && o.quality !== 'all' ? o.quality : '',
    o.sortBy || 'date_added', o.minimumRating || 0,
  ]);
}

/** Warms the caches at startup: first pages of the default feed plus their posters. */
export async function prefetchYts(pages = 3) {
  try {
    const posters: string[] = [];
    for (let page = 1; page <= pages; page++) {
      const result = await listYtsMovies({ page, limit: 24, sortBy: 'date_added' }, true);
      result.movies.forEach(m => m.poster && posters.push(m.poster));
    }
    // The Movies page opens on these (50 per page): warm them so it appears instantly
    for (const page of [1, 2]) {
      const r = await listYtsMovies({ query: '', genre: 'all', quality: 'all', sortBy: 'date_added', page, limit: 50 }, true).catch(() => null);
      r?.movies.slice(0, 24).forEach(m => m.poster && posters.push(m.poster));
    }
    // Extra lists shown as rows on the Home page
    for (const extra of [
      { sortBy: 'download_count', limit: 24, page: 1 },
      { sortBy: 'rating', minimumRating: 7, limit: 24, page: 1 },
    ]) {
      const result = await listYtsMovies(extra, true).catch(() => null);
      result?.movies.forEach(m => m.poster && posters.push(m.poster));
    }
    let next = 0;
    const worker = async () => {
      while (next < posters.length) {
        const url = posters[next++];
        await fetchYtsImage(url).catch(() => undefined);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    console.log(`[yts] prefetched ${posters.length} posters`);
  } catch (err) {
    console.log('[yts] prefetch skipped:', err instanceof Error ? err.message : err);
  }
}

export function buildMagnet(hash: string, title: string): string {
  const trackers = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${trackers}`;
}

let customHost = '';

/** Sets a user-provided mirror (e.g. "https://yts.example") that is tried before the built-in ones. */
export function setYtsMirror(url: string) {
  const trimmed = (url || '').trim().replace(/\/+$/, '');
  customHost = /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

async function ytsFetch(endpoint: string, params: Record<string, string | number>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== '' && v !== undefined && v !== null) qs.set(k, String(v));
  }

  let lastError: unknown = null;
  const preferred = [customHost, lastGoodHost].filter(Boolean);
  const hosts = Array.from(new Set([...preferred, ...API_HOSTS]));
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}/api/v2/${endpoint}?${qs}`, {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': 'CineLocal/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      if (json.status !== 'ok') throw new Error(json.status_message || 'The movie source returned an error');
      lastGoodHost = host;
      return json.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Could not reach the movie source (${lastError instanceof Error ? lastError.message : 'unknown error'}). ` +
    'The site may be blocked on your network — try a VPN or custom DNS.'
  );
}

export interface YtsConnectionTest {
  ok: boolean;
  host?: string;
  ms?: number;
  error?: string;
}

/** Probes each mirror (custom first) and reports the first one that answers. */
export async function testYtsConnection(): Promise<YtsConnectionTest> {
  const hosts = Array.from(new Set([customHost, ...API_HOSTS].filter(Boolean)));
  const errors: string[] = [];
  for (const host of hosts) {
    const started = Date.now();
    try {
      const res = await fetch(`${host}/api/v2/list_movies.json?limit=1`, { signal: AbortSignal.timeout(5000) });
      const json: any = await res.json();
      if (!res.ok || json.status !== 'ok') throw new Error(`HTTP ${res.status}`);
      lastGoodHost = host;
      return { ok: true, host, ms: Date.now() - started };
    } catch (err) {
      errors.push(`${new URL(host).hostname}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }
  return { ok: false, error: `No mirror reachable (${errors.join('; ')})` };
}

function mapMovie(m: any): YtsMovie {
  const title: string = m.title_long || m.title;
  return {
    id: m.id,
    imdbCode: m.imdb_code || '',
    title: m.title,
    year: m.year,
    rating: m.rating || 0,
    runtime: m.runtime || 0,
    genres: m.genres || [],
    summary: m.summary || m.description_full || '',
    language: m.language || '',
    poster: m.large_cover_image || m.medium_cover_image || '',
    backdrop: m.background_image_original || m.background_image || '',
    trailerCode: m.yt_trailer_code || '',
    torrents: (m.torrents || []).map((t: any): YtsTorrent => ({
      quality: t.quality,
      type: t.type,
      videoCodec: t.video_codec || '',
      size: t.size,
      sizeBytes: t.size_bytes,
      seeds: t.seeds,
      peers: t.peers,
      hash: t.hash,
      magnet: buildMagnet(t.hash, `${title} [${t.quality}]`),
    })),
  };
}

export async function listYtsMovies(options: YtsListOptions = {}, forceRefresh = false): Promise<YtsListResult> {
  const key = cacheKey(options);
  const hit = getListCache()[key];
  if (hit && !forceRefresh && Date.now() - hit.time < LIST_TTL_MS) return hit.result;

  try {
    const result = await fetchYtsList(options);
    getListCache()[key] = { time: Date.now(), result };
    saveListCache();
    return result;
  } catch (err) {
    if (hit) return hit.result; // stale data beats an error screen
    throw err;
  }
}

async function fetchYtsList(options: YtsListOptions): Promise<YtsListResult> {
  const data = await ytsFetch('list_movies.json', {
    query_term: options.query || '',
    page: options.page || 1,
    limit: options.limit || 24,
    genre: options.genre && options.genre !== 'all' ? options.genre : '',
    quality: options.quality && options.quality !== 'all' ? options.quality : '',
    sort_by: options.sortBy || 'date_added',
    order_by: 'desc',
    minimum_rating: options.minimumRating || 0,
  });

  return {
    movies: (data.movies || []).map(mapMovie),
    total: data.movie_count || 0,
    page: data.page_number || 1,
    limit: data.limit || 24,
  };
}

export async function getYtsMovie(id: number): Promise<YtsMovie | null> {
  const data = await ytsFetch('movie_details.json', { movie_id: id, with_cast: 'false' });
  return data.movie && data.movie.id ? mapMovie(data.movie) : null;
}
