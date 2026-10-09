// Movie catalogue client (port of electron/yts-service.ts for the Android WebView).
import type { YtsListOptions, YtsListResult, YtsMovie, YtsTorrent } from '../../src/types';
import { getJson, cacheGet, cacheSet } from './native';
import { getSetting } from './settings';

const API_HOSTS = ['https://movies-api.accel.li', 'https://yts.gg', 'https://yts.mx', 'https://yts.lt', 'https://yts.am', 'https://yts.rs'];
let lastGoodHost = '';

const TRACKERS = [
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:80',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://p4p.arenabg.com:1337',
  'udp://tracker.leechers-paradise.org:6969',
  'wss://tracker.openwebtorrent.com',
];

export function buildMagnet(hash: string, title: string): string {
  const trackers = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(title)}${trackers}`;
}

function customHost(): string {
  const v = getSetting('ytsMirror').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(v) ? v : '';
}

async function ytsFetch(endpoint: string, params: Record<string, string | number>): Promise<any> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) qs.set(k, String(v));

  const hosts = Array.from(new Set([customHost(), lastGoodHost, ...API_HOSTS].filter(Boolean)));
  let lastError: unknown = null;
  for (const host of hosts) {
    try {
      const json = await getJson(`${host}/api/v2/${endpoint}?${qs}`, 7000);
      if (json.status !== 'ok') throw new Error(json.status_message || 'The movie source returned an error');
      lastGoodHost = host;
      return json.data;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not reach the movie source (${lastError instanceof Error ? lastError.message : 'unknown error'}).`);
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

const LIST_TTL_MS = 10 * 60 * 1000;

export async function listYtsMovies(o: YtsListOptions = {}): Promise<YtsListResult> {
  const key = 'yts:' + JSON.stringify([
    (o.query || '').trim().toLowerCase(), o.page || 1, o.limit || 24,
    o.genre && o.genre !== 'all' ? o.genre : '', o.quality && o.quality !== 'all' ? o.quality : '',
    o.sortBy || 'date_added', o.minimumRating || 0,
  ]);
  const hit = cacheGet<YtsListResult>(key, LIST_TTL_MS);
  if (hit?.fresh) return hit.value;

  try {
    const data = await ytsFetch('list_movies.json', {
      query_term: o.query || '',
      page: o.page || 1,
      limit: o.limit || 24,
      genre: o.genre && o.genre !== 'all' ? o.genre : '',
      quality: o.quality && o.quality !== 'all' ? o.quality : '',
      sort_by: o.sortBy || 'date_added',
      order_by: 'desc',
      minimum_rating: o.minimumRating || 0,
    });
    const result: YtsListResult = {
      movies: (data.movies || []).map(mapMovie),
      total: data.movie_count || 0,
      page: data.page_number || 1,
      limit: data.limit || 24,
    };
    cacheSet(key, result);
    return result;
  } catch (err) {
    if (hit) return hit.value; // stale beats an error screen
    throw err;
  }
}

export async function getYtsMovie(id: number): Promise<YtsMovie | null> {
  const data = await ytsFetch('movie_details.json', { movie_id: id, with_cast: 'false' });
  return data.movie && data.movie.id ? mapMovie(data.movie) : null;
}

export async function testYtsConnection(): Promise<{ ok: boolean; host?: string; ms?: number; error?: string }> {
  const hosts = Array.from(new Set([customHost(), ...API_HOSTS].filter(Boolean)));
  const errors: string[] = [];
  for (const host of hosts) {
    const started = Date.now();
    try {
      const json = await getJson(`${host}/api/v2/list_movies.json?limit=1`, 5000);
      if (json.status !== 'ok') throw new Error('bad response');
      lastGoodHost = host;
      return { ok: true, host, ms: Date.now() - started };
    } catch (err) {
      errors.push(`${new URL(host).hostname}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }
  return { ok: false, error: `No mirror reachable (${errors.join('; ')})` };
}
