// TV / web series: show metadata + episode lists from TVMaze, episode torrents from EZTV.
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { getJsonViaDoh, resilientFetch } from './net-util';
import { fetchYtsImage } from './yts-service';

const TVMAZE = process.env.CINEMUAH_TVMAZE || 'https://api.tvmaze.com'; // override is for testing outages
// EZTV domains are blocked by DNS poisoning on some ISPs, so they are always reached via DNS-over-HTTPS.
const EZTV_HOSTS = ['https://eztv.yt', 'https://eztv.wf', 'https://eztv.re', 'https://eztvx.to', 'https://eztv.tf'];
let lastGoodEztv = '';

export interface SeriesTorrent {
  quality: string;
  codec: string;
  size: string;
  sizeBytes: number;
  seeds: number;
  peers: number;
  hash: string;
  magnet: string;
  release: string;
}

export interface SeriesEpisode {
  season: number;
  number: number;
  name: string;
  airdate: string;
  summary: string;
  image: string;
  torrents: SeriesTorrent[];
}

export interface SeriesShow {
  id: number;
  imdbId: string;
  title: string;
  year: number;
  summary: string;
  poster: string;
  posterLarge: string;
  genres: string[];
  language: string;
  rating: number;
  status: string;
  network: string;
}

export interface SeriesDetail {
  show: SeriesShow;
  episodes: SeriesEpisode[];
  /** Set when the episode list loaded but the torrent source could not be reached. */
  sourcesError?: string;
  /** Shown to the user when the data is partial or older than usual. */
  notice?: string;
}

export interface SeriesListResult {
  shows: SeriesShow[];
  total: number;
  page: number;
  limit: number;
}

export interface SeriesListOptions {
  query?: string;
  page?: number;
  limit?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

const stripHtml = (s: string | null | undefined) => (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").trim();

function formatSize(bytes: number): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i < 2 ? 0 : 1)} ${units[i]}`;
}

/** Levenshtein distance, used to tell typos ("severence") from unrelated fuzzy matches. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// When TVMaze can't be connected to, remember it for a while so every other lookup fails at once instead of
// each waiting out its own timeout (a page of 24 shows used to mean 24 waits).
let tvmazeDownUntil = 0;
let tvmazeFailures = 0; // consecutive connection failures

async function tvmaze(pathAndQuery: string, opts: { timeoutMs?: number; attempts?: number } = {}): Promise<any | null> {
  let lastError: unknown = null;
  const attempts = opts.attempts ?? 2;
  if (Date.now() < tvmazeDownUntil) throw new Error('TVMaze is not reachable right now.');
  // Episode lists for long-running shows are big; allow a slow answer and retry once before giving up
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await resilientFetch(`${TVMAZE}${pathAndQuery}`, {
        timeoutMs: opts.timeoutMs ?? (attempt === 0 ? 20000 : 30000),
        headers: { 'User-Agent': 'CineLocal/1.0' },
      });
      if (res.status === 404) return null;
      if (res.status === 429) { lastError = new Error('TVMaze is rate limiting requests. Try again in a moment.'); await new Promise(r => setTimeout(r, 1500)); continue; }
      if (!res.ok) throw new Error(`TVMaze HTTP ${res.status}`);
      tvmazeDownUntil = 0;
      tvmazeFailures = 0;
      return await res.json();
    } catch (err) {
      lastError = err;
      const code = (err as { cause?: { code?: string } })?.cause?.code || '';
      if (/CONNECT_TIMEOUT|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND/.test(code) || /fetch failed/.test((err as Error)?.message || '')) {
        // one flaky connection must not black out the rest: only a run of failures opens the breaker, briefly
        if (++tvmazeFailures >= 4) tvmazeDownUntil = Date.now() + 8000;
        break;
      }
      if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 800));
    }
  }
  const msg = lastError instanceof Error ? lastError.message : '';
  throw new Error(/timeout|abort/i.test(msg) ? 'The episode list is taking too long to load. Check your connection and try again.' : (msg || 'Could not load the episode list.'));
}

/**
 * Tries the torrent hosts in a staggered race: the last good one starts immediately, the others join after 2.5 s
 * each if it hasn't answered, and the first success wins. (Trying them one after another took over a minute
 * when the first hosts were down.)
 */
async function eztv(pathAndQuery: string): Promise<any> {
  const hosts = Array.from(new Set([lastGoodEztv, ...EZTV_HOSTS].filter(Boolean)));
  return new Promise((resolve, reject) => {
    let failed = 0;
    let firstError: unknown = null;
    hosts.forEach(async (host, i) => {
      try {
        if (i > 0) await new Promise(r => setTimeout(r, i * 2500));
        const json = await getJsonViaDoh(`${host}${pathAndQuery}`, 12000);
        if (lastGoodEztv !== host) { lastGoodEztv = host; const c = getCache(); c.eztvHost = host; saveCache(); }
        resolve(json);
      } catch (err) {
        if (firstError === null) firstError = err;
        if (++failed === hosts.length) {
          reject(new Error(`Could not reach the torrent source (${firstError instanceof Error ? firstError.message : 'unknown error'}).`));
        }
      }
    });
  });
}

function mapShow(s: any): SeriesShow {
  return {
    id: s.id,
    imdbId: s.externals?.imdb || '',
    title: s.name,
    year: s.premiered ? parseInt(String(s.premiered).slice(0, 4), 10) : 0,
    summary: stripHtml(s.summary),
    poster: s.image?.medium || '',
    posterLarge: s.image?.original || s.image?.medium || '',
    genres: s.genres || [],
    language: s.language || '',
    rating: s.rating?.average || 0,
    status: s.status || '',
    network: s.network?.name || s.webChannel?.name || '',
  };
}

function mapTorrent(t: any): SeriesTorrent {
  const name: string = t.filename || t.title || '';
  const quality = /(2160p|1080p|720p|480p)/i.exec(name)?.[1].toLowerCase() || 'SD';
  const codec = /x265|hevc|h\.?265/i.test(name) ? 'x265' : /x264|h\.?264|avc/i.test(name) ? 'x264' : /xvid/i.test(name) ? 'xvid' : '';
  return {
    quality, codec,
    size: formatSize(Number(t.size_bytes) || 0),
    sizeBytes: Number(t.size_bytes) || 0,
    seeds: t.seeds || 0,
    peers: t.peers || 0,
    hash: String(t.hash || '').toLowerCase(),
    magnet: t.magnet_url || '',
    release: name,
  };
}

// ─── Persistent cache ───────────────────────────────────────────────

interface PoolEntry { imdbId: string; score: number; seeds?: number; peers?: number; count?: number; title?: string; shot?: string; seen?: number }
interface SeriesCache {
  pool?: { time: number; list: PoolEntry[]; v?: number; deepAt?: number };
  shows: Record<string, { time: number; show: SeriesShow | null }>;
  /** The torrent host that answered last time: tried first, so a cold start doesn't wait on blocked ones. */
  eztvHost?: string;
  seeded?: number;
}
const POOL_TTL_MS = 15 * 60 * 1000;
const SHOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let cache: SeriesCache | null = null;
let saveTimer: NodeJS.Timeout | null = null;

const cacheFile = () => path.join(app.getPath('userData'), 'series-cache.json');

function getCache(): SeriesCache {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { cache = null; }
  if (!cache) cache = seedCache();
  if (!cache.shows) cache.shows = {};
  // An existing cache from an older version gains the bundled shows it doesn't have yet, and a ranked list to start from
  if (!cache.seeded) {
    const seed = seedCache();
    for (const [k, v] of Object.entries(seed.shows)) if (!cache.shows[k]) cache.shows[k] = v;
    if (!cache.pool || cache.pool.v !== POOL_VERSION) cache.pool = seed.pool ?? cache.pool;
    cache.seeded = 1;
  }
  if (cache.eztvHost && !lastGoodEztv) lastGoodEztv = cache.eztvHost;
  return cache;
}

/**
 * First launch: start from a bundled snapshot of popular shows (details and a ranked list), so the Series page
 * opens at once instead of looking everything up over the network. The list is marked stale and refreshed in the
 * background; the show details stay valid for most of a week.
 */
function seedCache(): SeriesCache {
  try {
    const file = path.join(__dirname, '..', '..', 'dist', 'series-seed.json');
    const seed = JSON.parse(fs.readFileSync(file, 'utf8')) as SeriesCache;
    const now = Date.now();
    for (const e of Object.values(seed.shows || {})) e.time = now - 24 * 60 * 60 * 1000;
    if (seed.pool) seed.pool.time = 0;
    return { shows: seed.shows || {}, pool: seed.pool };
  } catch {
    return { shows: {} };
  }
}

function saveCache() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { fs.writeFileSync(cacheFile(), JSON.stringify(getCache())); } catch { /* best effort */ }
  }, 2000);
}

// ─── Trending ───────────────────────────────────────────────────────

let poolPromise: Promise<PoolEntry[]> | null = null;
let deepPromise: Promise<void> | null = null;

/** A show needs at least one release with this many seeders to be listed: only titles that can really be streamed. */
const GOOD_SEEDS = 5;
const QUICK_PAGES = 5;         // newest ~500 releases: enough to show a first page straight away
const DEEP_PAGES = 150;        // ~15000 releases, crawled in the background
const POOL_KEEP_MS = 45 * 24 * 60 * 60 * 1000;
const DEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const POOL_VERSION = 4;

const showTitleOf = (t: any): string => String(t.title || t.filename || '')
  .replace(/\s+S\d{1,2}E\d{1,3}.*$/i, '').replace(/\s+\d{4}\s+\d{2}\s+\d{2}.*$/, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
const shotOf = (t: any): string => {
  const u = String(t.large_screenshot || t.small_screenshot || '');
  return u.startsWith('//') ? 'https:' + u : u.startsWith('http') ? u : '';
};

/** Folds a batch of torrents into the per-show tally (seeders, score, a title and artwork for shows TVMaze doesn't know). */
function absorb(map: Map<string, PoolEntry>, torrents: any[]) {
  const now = Date.now();
  for (const t of torrents) {
    const id = String(t.imdb_id || '0');
    if (id === '0') continue;
    const seeds = Number(t.seeds) || 0;
    const peers = Number(t.peers) || 0;
    const e = map.get(id) ?? { imdbId: id, score: 0, seeds: 0, peers: 0, count: 0, seen: now };
    if (seeds > 0 || peers > 0) e.count = (e.count ?? 0) + 1;
    e.seeds = Math.max(e.seeds ?? 0, seeds);
    e.peers = Math.max(e.peers ?? 0, peers);
    // ranking: how healthy the best release is (seeders count double), plus a little for a steady stream of releases
    e.score = (e.seeds ?? 0) * 2 + (e.peers ?? 0) + Math.min(e.count ?? 0, 20) * 2;
    e.seen = now;
    if (!e.title) e.title = showTitleOf(t);
    if (!e.shot) e.shot = shotOf(t);
    map.set(id, e);
  }
}

/** Merges fresh findings into the saved pool (older shows stay for a while) and returns the sorted, filtered list. */
function mergePool(c: SeriesCache, fresh: Map<string, PoolEntry>): PoolEntry[] {
  const all = new Map<string, PoolEntry>();
  for (const old of c.pool?.list ?? []) if (old.seen && Date.now() - old.seen < POOL_KEEP_MS) all.set(old.imdbId, old);
  for (const [id, e] of fresh) {
    const prev = all.get(id);
    all.set(id, prev ? { ...prev, ...e, score: Math.max(prev.score, e.score), seeds: Math.max(prev.seeds ?? 0, e.seeds ?? 0), peers: Math.max(prev.peers ?? 0, e.peers ?? 0), count: Math.max(prev.count ?? 0, e.count ?? 0), title: e.title || prev.title, shot: e.shot || prev.shot } : e);
  }
  return [...all.values()].filter(e => (e.seeds ?? 0) >= GOOD_SEEDS).sort((a, b) => b.score - a.score);
}

/** Keeps crawling older releases in the background so every well-seeded series ends up in the library. */
function crawlDeep(): Promise<void> {
  const c = getCache();
  if (deepPromise) return deepPromise;
  if (c.pool?.deepAt && Date.now() - c.pool.deepAt < DEEP_EVERY_MS) return Promise.resolve();
  deepPromise = (async () => {
    try {
      const fresh = new Map<string, PoolEntry>();
      for (let start = QUICK_PAGES + 1; start <= DEEP_PAGES; start += 5) {
        const batch = await Promise.all(Array.from({ length: 5 }, (_, i) =>
          eztv(`/api/get-torrents?limit=100&page=${start + i}`).then(j => j.torrents || []).catch(() => null)));
        const got = batch.filter((b): b is any[] => !!b);
        if (got.length === 0 || got.every(b => b.length === 0)) break;
        got.forEach(b => absorb(fresh, b));
        if (c.pool) { c.pool.list = mergePool(c, fresh); saveCache(); }  // the library grows while it crawls
        await new Promise(r => setTimeout(r, 300));
      }
      if (c.pool) { c.pool.deepAt = Date.now(); saveCache(); }
    } catch { /* try again next time */ } finally { deepPromise = null; }
  })();
  return deepPromise;
}

/** Shows with active recent EZTV releases and good seeders, most seeded first. */
async function trendingPool(force = false): Promise<PoolEntry[]> {
  const c = getCache();
  if (!force && c.pool && c.pool.v === POOL_VERSION) {
    // A saved list is returned straight away; if it is old, refresh it quietly for next time
    if (Date.now() - c.pool.time >= POOL_TTL_MS && !poolPromise) trendingPool(true).catch(() => undefined);
    else void crawlDeep();
    return c.pool.list;
  }
  if (poolPromise) return poolPromise;

  poolPromise = (async () => {
    try {
      const fresh = new Map<string, PoolEntry>();
      const pages = await Promise.all(Array.from({ length: QUICK_PAGES }, (_, i) =>
        eztv(`/api/get-torrents?limit=100&page=${i + 1}`).then(j => j.torrents || []).catch(() => [])));
      pages.forEach(b => absorb(fresh, b));
      const list = mergePool(c, fresh);
      if (list.length === 0) throw new Error('No recent releases found');
      c.pool = { time: Date.now(), list, v: POOL_VERSION, deepAt: c.pool?.v === POOL_VERSION ? c.pool.deepAt : undefined };
      saveCache();
      void crawlDeep();
      return list;
    } catch (err) {
      if (c.pool) return c.pool.list; // stale beats nothing
      throw err;
    } finally {
      poolPromise = null;
    }
  })();
  return poolPromise;
}

/** A show TVMaze has no record of: listed from what the releases tell us, so it is not lost. */
function fallbackShow(entry: PoolEntry): SeriesShow {
  return {
    id: -Number(entry.imdbId),
    imdbId: 'tt' + entry.imdbId.padStart(7, '0'),
    title: entry.title || 'Unknown show',
    year: 0, summary: '', poster: entry.shot || '', posterLarge: entry.shot || '',
    genres: [], language: '', rating: 0, status: '', network: '',
  };
}

// TVMaze allows about 20 calls per 10 s. A big library means hundreds of first-time lookups, so they are paced
// (they are cached for a week afterwards) instead of firing in bursts that get rate limited and dropped.
const lookupTimes: number[] = [];
async function lookupSlot() {
  // sliding window: a burst of up to 18 is fine (a first page appears at once), then they are spread out
  for (;;) {
    const now = Date.now();
    while (lookupTimes.length && now - lookupTimes[0] > 10500) lookupTimes.shift();
    if (lookupTimes.length < 18) { lookupTimes.push(now); return; }
    await new Promise(r => setTimeout(r, lookupTimes[0] + 10500 - now + 20));
  }
}

async function showByImdb(imdbId: string, entry?: PoolEntry): Promise<SeriesShow | null> {
  const c = getCache();
  const hit = c.shows[imdbId];
  if (hit && Date.now() - hit.time < SHOW_TTL_MS) return hit.show ?? (entry ? fallbackShow(entry) : null);
  try {
    await lookupSlot();
    const raw = await tvmaze(`/lookup/shows?imdb=tt${imdbId.padStart(7, '0')}`, { timeoutMs: 9000, attempts: 1 });
    const show = raw ? mapShow(raw) : null;
    c.shows[imdbId] = { time: Date.now(), show };
    saveCache();
    return show ?? (entry ? fallbackShow(entry) : null);
  } catch (err) {
    if (hit) return hit.show ?? (entry ? fallbackShow(entry) : null);
    throw err; // unknown show and no connection: let the caller retry instead of silently dropping it
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function listSeries(options: SeriesListOptions = {}): Promise<SeriesListResult> {
  const limit = options.limit || 24;
  const page = options.page || 1;
  const query = (options.query || '').trim();

  if (query) {
    if (page > 1) return { shows: [], total: 0, page, limit };
    const results = (await tvmaze(`/search/shows?q=${encodeURIComponent(query)}`)) || [];
    // Shows without an IMDb id cannot be matched to torrents
    const all = results.map((r: any) => mapShow(r.show)).filter((s: SeriesShow) => s.imdbId);
    // TVMaze matches loosely ("inception" also returns "Deception"): keep titles that contain the
    // query, and only fall back to its closest few when nothing contains it (e.g. typos).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const q = norm(query);
    const exact = all.filter((s: SeriesShow) => norm(s.title).includes(q));
    const maxEdits = Math.max(1, Math.floor(q.length / 5));
    const shows = exact.length > 0
      ? exact
      : all.filter((s: SeriesShow) => editDistance(norm(s.title), q) <= maxEdits).slice(0, 3);
    return { shows, total: shows.length, page, limit };
  }

  const pool = await trendingPool();
  const slice = pool.slice((page - 1) * limit, page * limit);
  type Look = { show?: SeriesShow | null; failed?: boolean };
  const lookup = (e: PoolEntry): Promise<Look> => showByImdb(e.imdbId, e).then(show => ({ show }), () => ({ failed: true }));
  const results: Look[] = await mapLimit(slice, 8, lookup);
  // Lookups that failed on the network get up to two more tries once the burst has passed
  for (let round = 0; round < 3 && results.some(r => r.failed); round++) {
    await new Promise(r => setTimeout(r, 1500 * (round + 1)));
    const again = results.map((r, i) => (r.failed ? i : -1)).filter(i => i >= 0);
    const redone = await mapLimit(again, 4, i => lookup(slice[i]));
    again.forEach((i, k) => { results[i] = redone[k]; });
  }
  const shows = results.map(r => r.show).filter((s): s is SeriesShow => !!s);
  return { shows, total: pool.length, page, limit };
}

// ─── Detail ─────────────────────────────────────────────────────────

const detailCache = new Map<number, { time: number; detail: SeriesDetail }>();
const DETAIL_TTL_MS = 10 * 60 * 1000;

// Episode lists are also kept on disk: shows open instantly next time, and still open when TVMaze can't be reached
const detailFile = () => path.join(app.getPath('userData'), 'series-detail-cache.json');
let diskDetails: Record<string, { time: number; detail: SeriesDetail }> | null = null;
let diskTimer: NodeJS.Timeout | null = null;
function loadDisk() {
  if (diskDetails) return diskDetails;
  try { diskDetails = JSON.parse(fs.readFileSync(detailFile(), 'utf8')); } catch { diskDetails = {}; }
  return diskDetails!;
}
function saveDisk(id: number, entry: { time: number; detail: SeriesDetail }) {
  const d = loadDisk();
  d[String(id)] = entry;
  if (diskTimer) return;
  diskTimer = setTimeout(() => {
    diskTimer = null;
    const keys = Object.keys(d).sort((a, b) => d[b].time - d[a].time);
    keys.slice(40).forEach(k => delete d[k]);
    fs.promises.writeFile(detailFile(), JSON.stringify(d)).catch(() => undefined);
  }, 3000);
}

/** Last resort when TVMaze is down: build the episode list from the torrent releases themselves. */
async function detailFromReleases(id: number): Promise<SeriesDetail | null> {
  const c = getCache();
  const show = id < 0
    ? (() => { const e = c.pool?.list.find(x => -Number(x.imdbId) === id); return e ? fallbackShow(e) : undefined; })()
    : Object.values(c.shows).map(e => e.show).find(s => s && s.id === id);
  if (!show || !show.imdbId) return null;
  const numericId = show.imdbId.replace(/^tt/, '').replace(/^0+/, '');
  const first = await eztv(`/api/get-torrents?imdb_id=${numericId}&limit=100&page=1`);
  const pages = Math.min(8, Math.ceil((first.torrents_count || 0) / 100));
  const rest = pages > 1
    ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => eztv(`/api/get-torrents?imdb_id=${numericId}&limit=100&page=${i + 2}`).catch(() => null)))
    : [];
  const byKey = new Map<string, SeriesEpisode>();
  for (const json of [first, ...rest]) {
    for (const t of (json?.torrents || []) as any[]) {
      const season = parseInt(t.season, 10);
      const number = parseInt(t.episode, 10);
      if (!season || !number) continue;
      const key = `${season}x${number}`;
      let ep = byKey.get(key);
      if (!ep) {
        const released = Number(t.date_released_unix) > 0 ? new Date(Number(t.date_released_unix) * 1000).toISOString().slice(0, 10) : '';
        ep = { season, number, name: '', airdate: released, summary: '', image: '', torrents: [] };
        byKey.set(key, ep);
      }
      const mapped = mapTorrent(t);
      if (mapped.magnet && (mapped.seeds > 0 || mapped.peers > 0)) ep.torrents.push(mapped);
    }
  }
  const episodes = [...byKey.values()].sort((a, b) => a.season - b.season || a.number - b.number);
  if (episodes.length === 0) return null;
  return { show, episodes, notice: "Episode titles and air dates are unavailable right now because the show information service can't be reached. Episodes can still be played." };
}

export async function getSeries(id: number): Promise<SeriesDetail> {
  if (id < 0) {
    // a show TVMaze doesn't know: the list is built from its releases
    const d = await detailFromReleases(id);
    if (!d) throw new Error('Show not found');
    return { ...d, notice: 'There is no episode information for this show, so its episodes are listed by their releases.' };
  }

  const hit = detailCache.get(id) ?? loadDisk()[String(id)];
  if (hit && Date.now() - hit.time < DETAIL_TTL_MS) return hit.detail;

  // TVMaze is the source of episode titles. If it hasn't answered after a few seconds, start building the list
  // from the torrent releases in parallel and use whichever finishes first, so the window never just spins.
  const staleNotice = "Showing a saved copy of the episode list because the show information service can't be reached right now.";
  const tv = tvmaze(`/shows/${id}?embed=episodes`).then(raw => ({ raw }), err => ({ err }));
  let outcome: { raw?: any; err?: unknown; fallback?: SeriesDetail } = await Promise.race([
    tv,
    new Promise<'slow'>(r => setTimeout(() => r('slow'), 4000)),
  ]).then(r => (r === 'slow' ? null : r)) ?? {};
  if (outcome.raw === undefined && outcome.err === undefined) {
    const fb = detailFromReleases(id).then(fallback => fallback, () => null);
    outcome = await Promise.race([
      tv,
      fb.then(fallback => (fallback ? { fallback } : new Promise<never>(() => undefined))),
    ]);
  }
  if (outcome.fallback) return outcome.fallback;
  if (outcome.err !== undefined) {
    if (hit) return { ...hit.detail, notice: staleNotice };
    const fallback = await detailFromReleases(id).catch(() => null);
    if (fallback) return fallback;
    throw outcome.err;
  }
  const raw = outcome.raw;
  if (!raw) throw new Error('Show not found');
  const show = mapShow(raw);
  const episodes: SeriesEpisode[] = (raw._embedded?.episodes || []).map((e: any): SeriesEpisode => ({
    season: e.season,
    number: e.number ?? 0,
    name: e.name || '',
    airdate: e.airdate || '',
    summary: stripHtml(e.summary),
    image: e.image?.medium || '',
    torrents: [],
  })).filter((e: SeriesEpisode) => e.number > 0);

  // Attach EZTV torrents by season/episode number
  let sourcesError = '';
  if (show.imdbId) {
    const byKey = new Map(episodes.map(e => [`${e.season}x${e.number}`, e]));
    const numericId = show.imdbId.replace(/^tt/, '').replace(/^0+/, '');
    const attach = (json: any) => {
      for (const t of (json?.torrents || []) as any[]) {
        const ep = byKey.get(`${parseInt(t.season, 10)}x${parseInt(t.episode, 10)}`);
        const mapped = mapTorrent(t);
        if (ep && mapped.magnet && (mapped.seeds > 0 || mapped.peers > 0)) ep.torrents.push(mapped);
      }
    };
    try {
      const first = await eztv(`/api/get-torrents?imdb_id=${numericId}&limit=100&page=1`);
      attach(first);
      // Remaining pages (long shows have hundreds of releases) are fetched together, not one by one
      const pages = Math.min(8, Math.ceil((first.torrents_count || 0) / 100));
      if (pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
          eztv(`/api/get-torrents?imdb_id=${numericId}&limit=100&page=${i + 2}`).catch(() => null)));
        rest.forEach(attach);
      }
    } catch (err) {
      // Still show the episode list; the UI offers a retry for the sources
      sourcesError = err instanceof Error ? err.message : 'The torrent source could not be reached.';
    }
  }

  const detail: SeriesDetail = { show: { ...show, imdbId: show.imdbId }, episodes, ...(sourcesError ? { sourcesError } : {}) };
  if (!sourcesError) {
    const entry = { time: Date.now(), detail };
    detailCache.set(id, entry);
    saveDisk(id, entry);
  }
  return detail;
}

/** Warms the trending list, the first page of shows and their posters at startup. */
export async function prefetchSeries() {
  try {
    const first = await listSeries({ page: 1, limit: 24 });
    await mapLimit(first.shows, 6, s => (s.poster ? fetchYtsImage(s.poster).catch(() => undefined) : Promise.resolve(undefined)));
    console.log(`[series] prefetched ${first.shows.length} shows`);
    // The Series page opens on pages of 12: warm the next ones too so scrolling never waits on a lookup
    for (const page of [3, 4]) await listSeries({ page, limit: 12 }).catch(() => undefined);
  } catch (err) {
    console.log('[series] prefetch skipped:', err instanceof Error ? err.message : err);
  }
}
