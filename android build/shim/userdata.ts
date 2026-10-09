// Android implementation of the per-profile data the desktop app keeps in its database:
// profiles, watch history for streamed titles, playlists, followed shows and remembered caption / audio choices.
// Everything lives in localStorage, scoped to the active profile.
import type { Profile, StreamHistoryItem, PlaylistSummary, PlaylistItem, FollowedShow } from '../../src/types';

const load = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
};
const save = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));
const now = () => Math.floor(Date.now() / 1000);

// ─── profiles ───────────────────────────────────────────────────────

interface StoredProfile extends Omit<Profile, 'hasPin'> { pinHash: string; createdAt: number }

const PROFILES_KEY = 'cm:profiles';
const ACTIVE_KEY = 'cm:profile:active';

function profiles(): StoredProfile[] {
  let list = load<StoredProfile[]>(PROFILES_KEY, []);
  if (list.length === 0) {
    list = [{ id: 1, name: 'Me', color: '#e50914', avatar: 0, kids: false, pinHash: '', createdAt: now() }];
    save(PROFILES_KEY, list);
  }
  return list;
}

export function activeProfileId(): number {
  const id = Number(localStorage.getItem(ACTIVE_KEY)) || 1;
  return profiles().some(p => p.id === id) ? id : profiles()[0].id;
}

const publicProfile = (p: StoredProfile): Profile => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, kids: p.kids, hasPin: !!p.pinHash });

async function hashPin(pin: string): Promise<string> {
  const text = `cinemuah:${pin}`;
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'f' + (h >>> 0).toString(16);
  }
}

const cleanName = (name: string, max: number, what: string) => {
  const n = (name || '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!n) throw new Error(`Give the ${what} a name`);
  return n;
};

export const profilesApi = {
  list: async () => profiles().map(publicProfile),
  active: async () => publicProfile(profiles().find(p => p.id === activeProfileId())!),
  create: async (p: { name: string; color?: string; avatar?: number; kids?: boolean; pin?: string }) => {
    const list = profiles();
    const name = cleanName(p.name, 24, 'profile');
    if (list.some(x => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a profile called "${name}"`);
    if (p.pin && !/^\d{4}$/.test(p.pin)) throw new Error('The PIN must be 4 digits');
    if (list.length >= 6) throw new Error('You can have up to 6 profiles');
    const created: StoredProfile = {
      id: Math.max(...list.map(x => x.id)) + 1, name, color: p.color || '#e50914',
      avatar: Math.max(0, Math.floor(p.avatar ?? list.length)) % 8, kids: !!p.kids,
      pinHash: p.pin ? await hashPin(p.pin) : '', createdAt: now(),
    };
    save(PROFILES_KEY, [...list, created]);
    return publicProfile(created);
  },
  update: async (id: number, p: { name?: string; color?: string; avatar?: number; kids?: boolean; pin?: string | null }) => {
    const list = profiles();
    const target = list.find(x => x.id === id);
    if (!target) return;
    if (p.name !== undefined) {
      const name = cleanName(p.name, 24, 'profile');
      if (list.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a profile called "${name}"`);
      target.name = name;
    }
    if (p.color !== undefined) target.color = p.color;
    if (p.avatar !== undefined) target.avatar = Math.max(0, Math.floor(p.avatar)) % 8;
    if (p.kids !== undefined) target.kids = !!p.kids;
    if (p.pin !== undefined) {
      if (p.pin && !/^\d{4}$/.test(p.pin)) throw new Error('The PIN must be 4 digits');
      target.pinHash = p.pin ? await hashPin(p.pin) : '';
    }
    save(PROFILES_KEY, list);
  },
  delete: async (id: number) => {
    const list = profiles();
    if (list.length <= 1) throw new Error('You need at least one profile');
    save(PROFILES_KEY, list.filter(x => x.id !== id));
    for (const suffix of ['history', 'playlists', 'follows', 'prefs']) localStorage.removeItem(`cm:u:${id}:${suffix}`);
    localStorage.removeItem(`cm:progress:${id}`);
    localStorage.removeItem(`cm:mylist:${id}`);
    if (activeProfileId() === id) localStorage.setItem(ACTIVE_KEY, String(profiles()[0].id));
  },
  verify: async (id: number, pin: string) => {
    const p = profiles().find(x => x.id === id);
    if (!p) return false;
    return !p.pinHash || p.pinHash === (await hashPin(String(pin || '')));
  },
  switch: async (id: number, pin?: string) => {
    const p = profiles().find(x => x.id === id);
    if (!p) throw new Error('Profile not found');
    if (!(await profilesApi.verify(id, pin || ''))) throw new Error('Wrong PIN');
    localStorage.setItem(ACTIVE_KEY, String(id));
    return publicProfile(p);
  },
};

const ukey = (name: string) => `cm:u:${activeProfileId()}:${name}`;

// ─── stream watch history ───────────────────────────────────────────

const MIN_RESUME_SECONDS = 30;
const COMPLETED_RATIO = 0.92;
type History = Record<string, StreamHistoryItem>;

export const historyApi = {
  save: async (item: Omit<StreamHistoryItem, 'completed' | 'updatedAt'>) => {
    const all = load<History>(ukey('history'), {});
    const completed = item.duration > 0 && item.position / item.duration >= COMPLETED_RATIO ? 1 : 0;
    all[item.key] = { ...item, genres: item.genres || '', completed, updatedAt: now() };
    // keep the newest 200 so storage stays small
    const keys = Object.keys(all);
    if (keys.length > 200) keys.sort((a, b) => all[a].updatedAt - all[b].updatedAt).slice(0, keys.length - 200).forEach(k => delete all[k]);
    save(ukey('history'), all);
  },
  list: async () =>
    Object.values(load<History>(ukey('history'), {}))
      .filter(h => h.position > MIN_RESUME_SECONDS && !h.completed)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30),
  all: async () => Object.values(load<History>(ukey('history'), {})).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60),
  watched: async () => Object.values(load<History>(ukey('history'), {})).filter(h => h.completed).map(h => h.key),
  get: async (key: string) => load<History>(ukey('history'), {})[key] ?? null,
  remove: async (key: string) => {
    const all = load<History>(ukey('history'), {});
    delete all[key];
    save(ukey('history'), all);
  },
};

// ─── playlists ──────────────────────────────────────────────────────

interface StoredPlaylist { id: number; name: string; createdAt: number; items: PlaylistItem[] }
const playlists = () => load<StoredPlaylist[]>(ukey('playlists'), []);
const savePlaylists = (list: StoredPlaylist[]) => save(ukey('playlists'), list);

export const playlistsApi = {
  list: async (): Promise<PlaylistSummary[]> =>
    [...playlists()].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).map(p => ({
      id: p.id, name: p.name, count: p.items.length,
      posters: [...p.items].sort((a, b) => b.addedAt - a.addedAt).map(i => i.poster).filter(Boolean).slice(0, 4),
    })),
  create: async (name: string): Promise<PlaylistSummary> => {
    const list = playlists();
    const n = cleanName(name, 60, 'playlist');
    if (list.some(p => p.name.toLowerCase() === n.toLowerCase())) throw new Error(`You already have a playlist called "${n}"`);
    const id = (list.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
    savePlaylists([...list, { id, name: n, createdAt: now(), items: [] }]);
    return { id, name: n, count: 0, posters: [] };
  },
  rename: async (id: number, name: string) => {
    const list = playlists();
    const p = list.find(x => x.id === id);
    if (!p) throw new Error('Playlist not found');
    const n = cleanName(name, 60, 'playlist');
    if (list.some(x => x.id !== id && x.name.toLowerCase() === n.toLowerCase())) throw new Error(`You already have a playlist called "${n}"`);
    p.name = n;
    savePlaylists(list);
  },
  delete: async (id: number) => savePlaylists(playlists().filter(p => p.id !== id)),
  items: async (id: number) => [...(playlists().find(p => p.id === id)?.items ?? [])].sort((a, b) => b.addedAt - a.addedAt),
  add: async (id: number, item: Omit<PlaylistItem, 'addedAt'>) => {
    const list = playlists();
    const p = list.find(x => x.id === id);
    if (!p) throw new Error('Playlist not found');
    p.items = [...p.items.filter(i => i.key !== item.key), { ...item, year: item.year || 0, poster: item.poster || '', addedAt: now() }];
    savePlaylists(list);
  },
  remove: async (id: number, key: string) => {
    const list = playlists();
    const p = list.find(x => x.id === id);
    if (p) { p.items = p.items.filter(i => i.key !== key); savePlaylists(list); }
  },
  membership: async (key: string) => playlists().filter(p => p.items.some(i => i.key === key)).map(p => p.id),
};

// ─── followed shows ─────────────────────────────────────────────────

export const followsApi = {
  list: async () => [...load<FollowedShow[]>(ukey('follows'), [])].sort((a, b) => b.addedAt - a.addedAt),
  follow: async (show: { showId: number; title: string; poster: string; payload: string }) => {
    const list = load<FollowedShow[]>(ukey('follows'), []).filter(s => s.showId !== show.showId);
    save(ukey('follows'), [...list, { ...show, poster: show.poster || '', addedAt: now() }]);
  },
  unfollow: async (showId: number) => save(ukey('follows'), load<FollowedShow[]>(ukey('follows'), []).filter(s => s.showId !== showId)),
};

// ─── remembered choices ─────────────────────────────────────────────

export const prefsApi = {
  get: async (scope: string) => load<Record<string, Record<string, unknown>>>(ukey('prefs'), {})[scope] ?? null,
  set: async (scope: string, patch: Record<string, unknown>) => {
    const all = load<Record<string, Record<string, unknown>>>(ukey('prefs'), {});
    all[scope] = { ...(all[scope] ?? {}), ...patch };
    save(ukey('prefs'), all);
  },
};
