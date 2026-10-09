// TV series client (port of electron/series-service.ts): TVMaze metadata + EZTV episode torrents.
// Mirrors the desktop behaviour: a wide, seed-ranked catalogue crawled in the background, shows TVMaze doesn't know
// still listed, episode lists that survive a TVMaze outage, and a bundled starting snapshot for instant first launch.
import type {
  SeriesShow, SeriesEpisode, SeriesTorrent, SeriesDetail, SeriesListResult,
} from '../../src/types';
import { getJson, cacheGet, cacheSet } from './native';

const TVMAZE = 'https://api.tvmaze.com';
const EZTV_HOSTS = ['https://eztv.yt', 'https://eztv.wf', 'https://eztv.re', 'https://eztvx.to', 'https://eztv.tf'];
let lastGoodEztv = localStorage.getItem('cm:eztvHost') || '';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const stripHtml = (s: string | null | undefined) =>
  (s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").trim();

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

// ─── TVMaze ─────────────────────────────────────────────────────────

// After a run of connection failures stop trying for a few seconds, so a page of lookups doesn't wait out a timeout each
let tvmazeDownUntil = 0;
let tvmazeFailures = 0;

async function tvmaze(pathAndQuery: string, opts: { timeoutMs?: number; attempts?: number } = {}): Promise<any | null> {
  const attempts = opts.attempts ?? 2;
  if (Date.now() < tvmazeDownUntil) throw new Error('TVMaze is not reachable right now.');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const json = await getJson(`${TVMAZE}${pathAndQuery}`, opts.timeoutMs ?? (attempt === 0 ? 20000 : 30000));
      tvmazeFailures = 0;
      tvmazeDownUntil = 0;
      return json;
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/HTTP 404/.test(msg)) return null;
      lastError = /HTTP 429/.test(msg) ? new Error('TVMaze is rate limiting requests. Try again in a moment.') : err;
      if (!/HTTP \d+/.test(msg) && ++tvmazeFailures >= 4) { tvmazeDownUntil = Date.now() + 8000; break; }
      if (attempt < attempts - 1) await sleep(800);
    }
  }
  const msg = lastError instanceof Error ? lastError.message : '';
  throw new Error(/timeout|abort|timed out/i.test(msg) ? 'The episode list is taking too long to load. Check your connection and try again.' : (msg || 'Could not load the episode list.'));
}

// TVMaze allows about 20 calls per 10 s: first-time lookups are paced (they are cached for a week afterwards)
const lookupTimes: number[] = [];
async function lookupSlot() {
  for (;;) {
    const now = Date.now();
    while (lookupTimes.length && now - lookupTimes[0] > 10500) lookupTimes.shift();
    if (lookupTimes.length < 18) { lookupTimes.push(now); return; }
    await sleep(lookupTimes[0] + 10500 - now + 20);
  }
}

// ─── EZTV (torrent hosts raced, staggered) ──────────────────────────

async function eztv(pathAndQuery: string): Promise<any> {
  const hosts = Array.from(new Set([lastGoodEztv, ...EZTV_HOSTS].filter(Boolean)));
  return new Promise((resolve, reject) => {
    let failed = 0;
    let firstError: unknown = null;
    hosts.forEach(async (host, i) => {
      try {
        if (i > 0) await sleep(i * 2500);
        const json = await getJson(`${host}${pathAndQuery}`, 12000);
        if (lastGoodEztv !== host) { lastGoodEztv = host; localStorage.setItem('cm:eztvHost', host); }
        resolve(json);
      } catch (err) {
        if (firstError === null) firstError = err;
        if (++failed === hosts.length) reject(new Error(`Could not reach the torrent source (${firstError instanceof Error ? firstError.message : 'unknown error'}).`));
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

// ─── Catalogue (every show with a well-seeded release) ──────────────

interface PoolEntry { imdbId: string; score: number; seeds?: number; peers?: number; count?: number; title?: string; shot?: string; seen?: number }
interface PoolCache { time: number; list: PoolEntry[]; v: number; deepAt?: number }

const POOL_TTL_MS = 15 * 60 * 1000;
const SHOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GOOD_SEEDS = 5;
const QUICK_PAGES = 5;
const DEEP_PAGES = 150;
const POOL_KEEP_MS = 45 * 24 * 60 * 60 * 1000;
const DEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const POOL_VERSION = 4;
const POOL_KEY = 'series:pool4';

let poolPromise: Promise<PoolEntry[]> | null = null;
let deepPromise: Promise<void> | null = null;
let memPool: PoolCache | null = null;

const readPool = (): PoolCache | null => memPool ?? (memPool = cacheGet<PoolCache>(POOL_KEY, Number.MAX_SAFE_INTEGER)?.value ?? null);
const writePool = (p: PoolCache) => { memPool = p; cacheSet(POOL_KEY, p); };

const showTitleOf = (t: any): string => String(t.title || t.filename || '')
  .replace(/\s+S\d{1,2}E\d{1,3}.*$/i, '').replace(/\s+\d{4}\s+\d{2}\s+\d{2}.*$/, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
const shotOf = (t: any): string => {
  const u = String(t.large_screenshot || t.small_screenshot || '');
  return u.startsWith('//') ? 'https:' + u : u.startsWith('http') ? u : '';
};

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
    // ranking: health of the best release (seeders count double) plus a little for a steady stream of releases
    e.score = (e.seeds ?? 0) * 2 + (e.peers ?? 0) + Math.min(e.count ?? 0, 20) * 2;
    e.seen = now;
    if (!e.title) e.title = showTitleOf(t);
    if (!e.shot) e.shot = shotOf(t);
    map.set(id, e);
  }
}

function mergePool(prev: PoolCache | null, fresh: Map<string, PoolEntry>): PoolEntry[] {
  const all = new Map<string, PoolEntry>();
  for (const old of prev?.list ?? []) if (old.seen && Date.now() - old.seen < POOL_KEEP_MS) all.set(old.imdbId, old);
  for (const [id, e] of fresh) {
    const p = all.get(id);
    all.set(id, p ? { ...p, ...e, score: Math.max(p.score, e.score), seeds: Math.max(p.seeds ?? 0, e.seeds ?? 0), peers: Math.max(p.peers ?? 0, e.peers ?? 0), count: Math.max(p.count ?? 0, e.count ?? 0), title: e.title || p.title, shot: e.shot || p.shot } : e);
  }
  return [...all.values()].filter(e => (e.seeds ?? 0) >= GOOD_SEEDS).sort((a, b) => b.score - a.score);
}

/** Keeps crawling older releases in the background so every well-seeded series ends up in the library. */
function crawlDeep(): Promise<void> {
  if (deepPromise) return deepPromise;
  const pool = readPool();
  if (pool?.deepAt && Date.now() - pool.deepAt < DEEP_EVERY_MS) return Promise.resolve();
  deepPromise = (async () => {
    try {
      const fresh = new Map<string, PoolEntry>();
      for (let start = QUICK_PAGES + 1; start <= DEEP_PAGES; start += 5) {
        const batch = await Promise.all(Array.from({ length: 5 }, (_, i) =>
          eztv(`/api/get-torrents?limit=100&page=${start + i}`).then(j => j.torrents || []).catch(() => null)));
        const got = batch.filter((b): b is any[] => !!b);
        if (got.length === 0 || got.every(b => b.length === 0)) break;
        got.forEach(b => absorb(fresh, b));
        const cur = readPool();
        if (cur) writePool({ ...cur, list: mergePool(cur, fresh) });
        await sleep(300);
      }
      const cur = readPool();
      if (cur) writePool({ ...cur, deepAt: Date.now() });
    } catch { /* try again next time */ } finally { deepPromise = null; }
  })();
  return deepPromise;
}

let seeded = false;
/** First launch: start from the bundled snapshot (popular shows with details + a ranked list). */
async function seedFromBundle() {
  if (seeded || localStorage.getItem('cm:seriesSeeded') === '1') { seeded = true; return; }
  seeded = true;
  try {
    const res = await fetch('./series-seed.json');
    if (!res.ok) return;
    const seed = await res.json() as { pool?: PoolCache; shows?: Record<string, { time: number; show: SeriesShow | null }> };
    for (const [imdb, e] of Object.entries(seed.shows ?? {})) {
      if (!cacheGet('series:show:' + imdb, SHOW_TTL_MS)) cacheSet('series:show:' + imdb, e.show);
    }
    if (seed.pool && (!readPool() || readPool()!.v !== POOL_VERSION)) writePool({ ...seed.pool, time: 0, v: POOL_VERSION, deepAt: undefined });
    localStorage.setItem('cm:seriesSeeded', '1');
  } catch { /* the network path still works */ }
}

async function trendingPool(force = false): Promise<PoolEntry[]> {
  await seedFromBundle();
  const cur = readPool();
  if (!force && cur && cur.v === POOL_VERSION) {
    if (Date.now() - cur.time >= POOL_TTL_MS && !poolPromise) trendingPool(true).catch(() => undefined);
    else void crawlDeep();
    return cur.list;
  }
  if (poolPromise) return poolPromise;
  poolPromise = (async () => {
    try {
      const fresh = new Map<string, PoolEntry>();
      const pages = await Promise.all(Array.from({ length: QUICK_PAGES }, (_, i) =>
        eztv(`/api/get-torrents?limit=100&page=${i + 1}`).then(j => j.torrents || []).catch(() => [])));
      pages.forEach(b => absorb(fresh, b));
      const list = mergePool(cur, fresh);
      if (list.length === 0) throw new Error('No recent releases found');
      writePool({ time: Date.now(), list, v: POOL_VERSION, deepAt: cur?.v === POOL_VERSION ? cur.deepAt : undefined });
      void crawlDeep();
      return list;
    } catch (err) {
      if (cur) return cur.list;
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

async function showByImdb(imdbId: string, entry?: PoolEntry): Promise<SeriesShow | null> {
  const key = 'series:show:' + imdbId;
  const hit = cacheGet<SeriesShow | null>(key, SHOW_TTL_MS);
  if (hit?.fresh) return hit.value ?? (entry ? fallbackShow(entry) : null);
  try {
    await lookupSlot();
    const raw = await tvmaze(`/lookup/shows?imdb=tt${imdbId.padStart(7, '0')}`, { timeoutMs: 9000, attempts: 1 });
    const show = raw ? mapShow(raw) : null;
    cacheSet(key, show);
    return show ?? (entry ? fallbackShow(entry) : null);
  } catch (err) {
    if (hit) return hit.value ?? (entry ? fallbackShow(entry) : null);
    throw err; // unknown show and no connection: the caller retries instead of silently dropping it
  }
}

export async function listSeries(o: { query?: string; page?: number; limit?: number } = {}): Promise<SeriesListResult> {
  const limit = o.limit || 24;
  const page = o.page || 1;
  const query = (o.query || '').trim();

  if (query) {
    if (page > 1) return { shows: [], total: 0, page, limit };
    const results = (await tvmaze(`/search/shows?q=${encodeURIComponent(query)}`)) || [];
    const all: SeriesShow[] = results.map((r: any) => mapShow(r.show)).filter((s: SeriesShow) => s.imdbId);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const q = norm(query);
    const exact = all.filter(s => norm(s.title).includes(q));
    const maxEdits = Math.max(1, Math.floor(q.length / 5));
    const shows = exact.length > 0 ? exact : all.filter(s => editDistance(norm(s.title), q) <= maxEdits).slice(0, 3);
    return { shows, total: shows.length, page, limit };
  }

  const pool = await trendingPool();
  const slice = pool.slice((page - 1) * limit, page * limit);
  type Look = { show?: SeriesShow | null; failed?: boolean };
  const lookup = (e: PoolEntry): Promise<Look> => showByImdb(e.imdbId, e).then(show => ({ show }), () => ({ failed: true }));
  const results: Look[] = await mapLimit(slice, 8, lookup);
  // Lookups that failed on the network get up to three more tries once the burst has passed
  for (let round = 0; round < 3 && results.some(r => r.failed); round++) {
    await sleep(1500 * (round + 1));
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
const DETAIL_INDEX = 'cm:series:detailIndex';

// A few recent episode lists are kept on the phone so shows reopen instantly and still open during an outage
function readSaved(id: number): { time: number; detail: SeriesDetail } | undefined {
  const hit = cacheGet<SeriesDetail>('series:detail:' + id, DETAIL_TTL_MS);
  return hit ? { time: Date.now() - (hit.fresh ? 0 : DETAIL_TTL_MS + 1), detail: hit.value } : undefined;
}
function writeSaved(id: number, detail: SeriesDetail) {
  const json = JSON.stringify(detail);
  if (json.length > 160000) return; // very long shows would eat the storage budget
  const index: number[] = (() => { try { return JSON.parse(localStorage.getItem(DETAIL_INDEX) || '[]'); } catch { return []; } })();
  const next = [id, ...index.filter(x => x !== id)];
  next.slice(8).forEach(old => localStorage.removeItem('cm:cache:series:detail:' + old));
  localStorage.setItem(DETAIL_INDEX, JSON.stringify(next.slice(0, 8)));
  cacheSet('series:detail:' + id, detail);
}

/** Last resort when TVMaze is down: build the episode list from the torrent releases themselves. */
async function detailFromReleases(id: number): Promise<SeriesDetail | null> {
  let show: SeriesShow | undefined;
  if (id < 0) {
    const e = readPool()?.list.find(x => -Number(x.imdbId) === id);
    if (e) show = fallbackShow(e);
  } else {
    for (let i = localStorage.length - 1; i >= 0 && !show; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('cm:cache:series:show:')) continue;
      try { const s = JSON.parse(localStorage.getItem(k) || '{}').v as SeriesShow | null; if (s && s.id === id) show = s; } catch { /* skip */ }
    }
  }
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
  return { show, episodes, notice: id < 0
    ? 'There is no episode information for this show, so its episodes are listed by their releases.'
    : "Episode titles and air dates are unavailable right now because the show information service can't be reached. Episodes can still be played." };
}

export async function getSeries(id: number): Promise<SeriesDetail> {
  if (id < 0) {
    const d = await detailFromReleases(id);
    if (!d) throw new Error('Show not found');
    return d;
  }
  const hit = detailCache.get(id) ?? readSaved(id);
  if (hit && Date.now() - hit.time < DETAIL_TTL_MS) return hit.detail;

  // TVMaze supplies the episode titles. If it hasn't answered after a few seconds, build the list from the releases
  // in parallel and use whichever finishes first, so the window never just spins.
  const staleNotice = "Showing a saved copy of the episode list because the show information service can't be reached right now.";
  const tv = tvmaze(`/shows/${id}?embed=episodes`).then(raw => ({ raw }), err => ({ err }));
  let outcome: { raw?: any; err?: unknown; fallback?: SeriesDetail } =
    (await Promise.race([tv, sleep(4000).then(() => null)])) ?? {};
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
      const pages = Math.min(8, Math.ceil((first.torrents_count || 0) / 100));
      if (pages > 1) {
        const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
          eztv(`/api/get-torrents?imdb_id=${numericId}&limit=100&page=${i + 2}`).catch(() => null)));
        rest.forEach(attach);
      }
    } catch (err) {
      sourcesError = err instanceof Error ? err.message : 'The torrent source could not be reached.';
    }
  }

  const detail: SeriesDetail = { show, episodes, ...(sourcesError ? { sourcesError } : {}) };
  if (!sourcesError) {
    detailCache.set(id, { time: Date.now(), detail });
    writeSaved(id, detail);
  }
  return detail;
}
