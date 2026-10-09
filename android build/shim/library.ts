// Offline library on Android = video files in Movies/Cinemuah (everything you downloaded).
// Watch progress and "My List" are kept in localStorage.
import type { Movie } from '../../src/types';
import { Native, isNative } from './native';
import { activeProfileId } from './userdata';

interface Progress { position: number; duration: number; lastPlayed: number; watchCount: number; completed: number }

// Progress and My List are per profile (the first profile inherits what was stored before profiles existed)
const PROGRESS_KEY = 'cm:progress';
const MYLIST_KEY = 'cm:mylist';
const progressKey = () => `${PROGRESS_KEY}:${activeProfileId()}`;
const myListKey = () => `${MYLIST_KEY}:${activeProfileId()}`;
for (const base of [PROGRESS_KEY, MYLIST_KEY]) {
  const legacy = localStorage.getItem(base);
  if (legacy !== null && localStorage.getItem(`${base}:1`) === null) localStorage.setItem(`${base}:1`, legacy);
}

const load = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
const save = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

function parseTitle(fileName: string): { title: string; year: number | null } {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/\[[^\]]*\]/g, ' ');
  const year = /[.\s(]((?:19|20)\d{2})[.\s)]/.exec(base + ' ');
  let title = year ? base.slice(0, year.index) : base;
  title = title.replace(/[._]/g, ' ').replace(/\s+/g, ' ').replace(/[-\s]+$/, '').trim();
  return { title: title || fileName, year: year ? parseInt(year[1], 10) : null };
}

let cache: Movie[] = [];
let loaded = false;

async function refresh(): Promise<Movie[]> {
  let items: { id: number; path: string; name: string; size: number; modified: number }[] = [];
  if (isNative) {
    try { items = (await Native.libraryList()).items; } catch { items = []; }
  }
  const progress = load<Record<string, Progress>>(progressKey(), {});
  const myList = new Set(load<number[]>(myListKey(), []));
  cache = items.map((f): Movie => {
    const { title, year } = parseTitle(f.name);
    const p = progress[f.id];
    return {
      id: f.id, filePath: f.path, fileName: f.name, title, year,
      description: '', poster: '', backdrop: '',
      duration: p?.duration ? Math.round(p.duration / 60) : 0,
      rating: 0, director: '', writers: '[]', cast: '[]', genres: '[]', tmdbId: null,
      dateAdded: f.modified, lastModified: f.modified, fileSize: f.size,
      isInMyList: myList.has(f.id) ? 1 : 0,
      position: p?.position, lastPlayed: p?.lastPlayed, watchCount: p?.watchCount, completed: p?.completed,
    };
  });
  loaded = true;
  return cache;
}

async function all(): Promise<Movie[]> {
  return loaded ? cache : refresh();
}

/** Forget the in-memory copy (progress and My List belong to the profile that was active). */
export const invalidateLibrary = () => { loaded = false; };

export const library = {
  scan: async () => {
    const before = cache.length;
    const movies = await refresh();
    return { totalFiles: movies.length, newMovies: Math.max(0, movies.length - before), removedMovies: 0, failedMovies: 0, skippedMovies: 0 };
  },

  getAll: async (options?: { sortBy?: string; order?: string }) => {
    const movies = [...(await refresh())];
    const sortBy = (options?.sortBy || 'dateAdded') as keyof Movie;
    const dir = options?.order === 'asc' ? 1 : -1;
    return movies.sort((a, b) => {
      if (sortBy === 'title') return dir * a.title.localeCompare(b.title);
      return dir * (((a[sortBy] as number) || 0) - ((b[sortBy] as number) || 0));
    });
  },
  getById: async (id: number) => (await all()).find(m => m.id === id) || null,
  search: async (q: string) => {
    const needle = q.toLowerCase();
    return (await all()).filter(m => m.title.toLowerCase().includes(needle));
  },
  getContinueWatching: async () =>
    (await all()).filter(m => (m.position || 0) > 5 && !m.completed).sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)),
  getRecentlyAdded: async () => [...(await all())].sort((a, b) => b.dateAdded - a.dateAdded).slice(0, 20),
  getMyList: async () => (await all()).filter(m => m.isInMyList),
  getCount: async () => (await all()).length,

  updateProgress: async (movieId: number, position: number, duration: number) => {
    const progress = load<Record<string, Progress>>(progressKey(), {});
    const prev = progress[movieId];
    const completed = duration > 0 && position / duration > 0.95 ? 1 : 0;
    progress[movieId] = {
      position: completed ? 0 : position,
      duration: duration || prev?.duration || 0,
      lastPlayed: Date.now(),
      watchCount: (prev?.watchCount || 0) + (completed && !prev?.completed ? 1 : 0),
      completed,
    };
    save(progressKey(), progress);
    const m = cache.find(x => x.id === movieId);
    if (m) Object.assign(m, { position: progress[movieId].position, lastPlayed: progress[movieId].lastPlayed, completed, duration: Math.round(progress[movieId].duration / 60) });
  },

  toggleMyList: async (movieId: number) => {
    const list = new Set(load<number[]>(myListKey(), []));
    const now = !list.has(movieId);
    if (now) list.add(movieId); else list.delete(movieId);
    save(myListKey(), Array.from(list));
    const m = cache.find(x => x.id === movieId);
    if (m) m.isInMyList = now ? 1 : 0;
    return now;
  },

  remove: async (id: number) => {
    if (isNative) await Native.libraryDelete({ id });
    await refresh();
  },
};
