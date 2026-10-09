// Per-profile data that lives next to the library: profiles, watch history for streamed titles,
// named playlists, followed shows and remembered caption / audio choices.
import crypto from 'crypto';
import { getDb, saveDb } from './database';
import { getProfileId, setProfileId } from './profile-state';
import { getSettings, setSetting } from './movie-store';

function all(sql: string, params: any[] = []): any[] {
  const stmt = getDb().prepare(sql);
  if (params.length) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function one(sql: string, params: any[] = []): any | null {
  return all(sql, params)[0] ?? null;
}

const run = (sql: string, params: any[] = []) => getDb().run(sql, params as any[]);
const now = () => Math.floor(Date.now() / 1000);
const hasColumn = (table: string, col: string) => all(`PRAGMA table_info(${table})`).some(c => c.name === col);

// ─── schema ─────────────────────────────────────────────────────────

export function initUserData(): void {
  run(`CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#e50914',
    kids INTEGER DEFAULT 0,
    pinHash TEXT DEFAULT '',
    avatar INTEGER DEFAULT 0,
    createdAt INTEGER NOT NULL
  )`);
  if (!hasColumn('profiles', 'avatar')) run('ALTER TABLE profiles ADD COLUMN avatar INTEGER DEFAULT 0');
  if (!one('SELECT id FROM profiles LIMIT 1')) {
    run('INSERT INTO profiles (id, name, color, kids, pinHash, createdAt) VALUES (1, ?, ?, 0, ?, ?)', ['Me', '#e50914', '', now()]);
  }

  // stream_history: one row per (profile, title)
  if (!one(`SELECT name FROM sqlite_master WHERE type='table' AND name='stream_history'`)) {
    run(`CREATE TABLE stream_history (
      profileId INTEGER NOT NULL DEFAULT 1,
      key TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT DEFAULT '',
      poster TEXT DEFAULT '',
      magnet TEXT NOT NULL,
      quality TEXT DEFAULT '',
      imdbId TEXT DEFAULT '',
      year INTEGER DEFAULT 0,
      season INTEGER DEFAULT 0,
      episode INTEGER DEFAULT 0,
      genres TEXT DEFAULT '',
      position REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      completed INTEGER DEFAULT 0,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (profileId, key)
    )`);
  } else if (!hasColumn('stream_history', 'profileId')) {
    run('ALTER TABLE stream_history RENAME TO stream_history_old');
    run(`CREATE TABLE stream_history (
      profileId INTEGER NOT NULL DEFAULT 1, key TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      subtitle TEXT DEFAULT '', poster TEXT DEFAULT '', magnet TEXT NOT NULL, quality TEXT DEFAULT '',
      imdbId TEXT DEFAULT '', year INTEGER DEFAULT 0, season INTEGER DEFAULT 0, episode INTEGER DEFAULT 0,
      genres TEXT DEFAULT '', position REAL DEFAULT 0, duration REAL DEFAULT 0, completed INTEGER DEFAULT 0,
      updatedAt INTEGER NOT NULL, PRIMARY KEY (profileId, key)
    )`);
    run(`INSERT INTO stream_history (profileId, key, kind, title, subtitle, poster, magnet, quality, imdbId, year, season, episode, position, duration, completed, updatedAt)
         SELECT 1, key, kind, title, subtitle, poster, magnet, quality, imdbId, year, season, episode, position, duration, completed, updatedAt FROM stream_history_old`);
    run('DROP TABLE stream_history_old');
  }

  // playlists: names are unique per profile
  if (!one(`SELECT name FROM sqlite_master WHERE type='table' AND name='playlists'`)) {
    run(`CREATE TABLE playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profileId INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL COLLATE NOCASE,
      createdAt INTEGER NOT NULL,
      UNIQUE (profileId, name)
    )`);
  } else if (!hasColumn('playlists', 'profileId')) {
    run('ALTER TABLE playlists RENAME TO playlists_old');
    run(`CREATE TABLE playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT, profileId INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL COLLATE NOCASE, createdAt INTEGER NOT NULL, UNIQUE (profileId, name)
    )`);
    run('INSERT INTO playlists (id, profileId, name, createdAt) SELECT id, 1, name, createdAt FROM playlists_old');
    run('DROP TABLE playlists_old');
  }

  run(`CREATE TABLE IF NOT EXISTS playlist_items (
    playlistId INTEGER NOT NULL,
    key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    year INTEGER DEFAULT 0,
    poster TEXT DEFAULT '',
    payload TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    PRIMARY KEY (playlistId, key)
  )`);

  run(`CREATE TABLE IF NOT EXISTS follows (
    profileId INTEGER NOT NULL,
    showId INTEGER NOT NULL,
    title TEXT NOT NULL,
    poster TEXT DEFAULT '',
    payload TEXT NOT NULL,
    addedAt INTEGER NOT NULL,
    PRIMARY KEY (profileId, showId)
  )`);

  run(`CREATE TABLE IF NOT EXISTS prefs (
    profileId INTEGER NOT NULL,
    scope TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (profileId, scope)
  )`);

  run(`CREATE TABLE IF NOT EXISTS app_downloads (path TEXT PRIMARY KEY, createdAt INTEGER NOT NULL)`);

  // Local library state per profile: progress and My List
  run(`CREATE TABLE IF NOT EXISTS my_list (
    profileId INTEGER NOT NULL,
    movieId INTEGER NOT NULL,
    PRIMARY KEY (profileId, movieId)
  )`);
  if (!hasColumn('watch_progress', 'profileId')) {
    run('ALTER TABLE watch_progress RENAME TO watch_progress_old');
    run(`CREATE TABLE watch_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profileId INTEGER NOT NULL DEFAULT 1,
      movieId INTEGER NOT NULL,
      position REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      lastPlayed INTEGER DEFAULT (strftime('%s', 'now')),
      watchCount INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      UNIQUE (profileId, movieId)
    )`);
    run(`INSERT INTO watch_progress (profileId, movieId, position, duration, lastPlayed, watchCount, completed)
         SELECT 1, movieId, position, duration, lastPlayed, watchCount, completed FROM watch_progress_old`);
    run('DROP TABLE watch_progress_old');
    run('INSERT OR IGNORE INTO my_list (profileId, movieId) SELECT 1, id FROM movies WHERE isInMyList = 1');
  }

  if (!hasColumn('stream_history', 'genres')) run(`ALTER TABLE stream_history ADD COLUMN genres TEXT DEFAULT ''`);

  const saved = Number(getSettings('activeProfile')) || 1;
  setProfileId(one('SELECT id FROM profiles WHERE id = ?', [saved]) ? saved : 1);
  saveDb();
}

// ─── profiles ───────────────────────────────────────────────────────

export interface Profile { id: number; name: string; color: string; avatar: number; kids: boolean; hasPin: boolean }

const hashPin = (pin: string) => crypto.createHash('sha256').update(`cinemuah:${pin}`).digest('hex');
const toProfile = (r: any): Profile => ({ id: r.id, name: r.name, color: r.color || '#e50914', avatar: Number(r.avatar) || 0, kids: !!r.kids, hasPin: !!r.pinHash });

export function listProfiles(): Profile[] {
  return all('SELECT * FROM profiles ORDER BY id').map(toProfile);
}

export function getActiveProfile(): Profile {
  return toProfile(one('SELECT * FROM profiles WHERE id = ?', [getProfileId()]) ?? one('SELECT * FROM profiles ORDER BY id LIMIT 1'));
}

function cleanProfileName(name: string): string {
  const n = (name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (!n) throw new Error('Give the profile a name');
  return n;
}

export function createProfile(p: { name: string; color?: string; avatar?: number; kids?: boolean; pin?: string }): Profile {
  const name = cleanProfileName(p.name);
  if (one('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE', [name])) throw new Error(`There is already a profile called "${name}"`);
  if (p.pin && !/^\d{4}$/.test(p.pin)) throw new Error('The PIN must be 4 digits');
  if (listProfiles().length >= 6) throw new Error('You can have up to 6 profiles');
  run('INSERT INTO profiles (name, color, avatar, kids, pinHash, createdAt) VALUES (?,?,?,?,?,?)',
    [name, p.color || '#e50914', Math.max(0, Math.floor(p.avatar ?? listProfiles().length)) % 8, p.kids ? 1 : 0, p.pin ? hashPin(p.pin) : '', now()]);
  const row = one('SELECT * FROM profiles WHERE name = ? COLLATE NOCASE', [name]);
  saveDb();
  return toProfile(row);
}

export function updateProfile(id: number, p: { name?: string; color?: string; avatar?: number; kids?: boolean; pin?: string | null }): void {
  if (p.name !== undefined) {
    const name = cleanProfileName(p.name);
    if (one('SELECT id FROM profiles WHERE name = ? COLLATE NOCASE AND id != ?', [name, id])) throw new Error(`There is already a profile called "${name}"`);
    run('UPDATE profiles SET name = ? WHERE id = ?', [name, id]);
  }
  if (p.color !== undefined) run('UPDATE profiles SET color = ? WHERE id = ?', [p.color, id]);
  if (p.avatar !== undefined) run('UPDATE profiles SET avatar = ? WHERE id = ?', [Math.max(0, Math.floor(p.avatar)) % 8, id]);
  if (p.kids !== undefined) run('UPDATE profiles SET kids = ? WHERE id = ?', [p.kids ? 1 : 0, id]);
  if (p.pin !== undefined) {
    if (p.pin && !/^\d{4}$/.test(p.pin)) throw new Error('The PIN must be 4 digits');
    run('UPDATE profiles SET pinHash = ? WHERE id = ?', [p.pin ? hashPin(p.pin) : '', id]);
  }
  saveDb();
}

export function deleteProfile(id: number): void {
  if (listProfiles().length <= 1) throw new Error('You need at least one profile');
  const playlistIds = all('SELECT id FROM playlists WHERE profileId = ?', [id]).map(r => r.id);
  for (const pid of playlistIds) run('DELETE FROM playlist_items WHERE playlistId = ?', [pid]);
  for (const t of ['playlists', 'stream_history', 'follows', 'prefs', 'my_list', 'watch_progress']) run(`DELETE FROM ${t} WHERE profileId = ?`, [id]);
  run('DELETE FROM profiles WHERE id = ?', [id]);
  if (getProfileId() === id) {
    const first = one('SELECT id FROM profiles ORDER BY id LIMIT 1');
    setProfileId(first.id);
    setSetting('activeProfile', String(first.id));
  }
  saveDb();
}

export function verifyPin(id: number, pin: string): boolean {
  const row = one('SELECT pinHash FROM profiles WHERE id = ?', [id]);
  if (!row) return false;
  return !row.pinHash || row.pinHash === hashPin(String(pin || ''));
}

export function switchProfile(id: number, pin?: string): Profile {
  const row = one('SELECT * FROM profiles WHERE id = ?', [id]);
  if (!row) throw new Error('Profile not found');
  if (!verifyPin(id, pin || '')) throw new Error('Wrong PIN');
  setProfileId(id);
  setSetting('activeProfile', String(id));
  return toProfile(row);
}

// ─── stream watch history (Continue Watching for online titles) ─────

export interface StreamHistoryItem {
  key: string;                 // yts:<id> or ep:<showId>:<season>x<episode>
  kind: 'movie' | 'episode';
  title: string;
  subtitle: string;
  poster: string;
  magnet: string;
  quality: string;
  imdbId: string;
  year: number;
  season: number;
  episode: number;
  genres: string;              // comma separated, used for recommendations
  position: number;
  duration: number;
  completed: number;
  updatedAt: number;
}

/** Titles shorter than this many seconds in are not "started yet". */
const MIN_RESUME_SECONDS = 30;
const COMPLETED_RATIO = 0.92;

export function saveStreamProgress(item: Omit<StreamHistoryItem, 'completed' | 'updatedAt'>): void {
  const completed = item.duration > 0 && item.position / item.duration >= COMPLETED_RATIO ? 1 : 0;
  run(
    `INSERT INTO stream_history (profileId, key, kind, title, subtitle, poster, magnet, quality, imdbId, year, season, episode, genres, position, duration, completed, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(profileId, key) DO UPDATE SET
       title = excluded.title, subtitle = excluded.subtitle, poster = excluded.poster, magnet = excluded.magnet,
       quality = excluded.quality, imdbId = excluded.imdbId, genres = excluded.genres, position = excluded.position,
       duration = excluded.duration, completed = excluded.completed, updatedAt = excluded.updatedAt`,
    [getProfileId(), item.key, item.kind, item.title, item.subtitle, item.poster, item.magnet, item.quality, item.imdbId,
      item.year, item.season, item.episode, item.genres || '', item.position, item.duration, completed, now()]
  );
  saveDb();
}

/** Streamed titles that were left part-way through, most recent first. */
export function listStreamHistory(limit = 30): StreamHistoryItem[] {
  return all(
    `SELECT * FROM stream_history WHERE profileId = ? AND position > ? AND completed = 0 ORDER BY updatedAt DESC LIMIT ?`,
    [getProfileId(), MIN_RESUME_SECONDS, limit]
  ) as StreamHistoryItem[];
}

/** Everything the profile has watched or started, for recommendations. */
export function listAllStreamHistory(limit = 60): StreamHistoryItem[] {
  return all('SELECT * FROM stream_history WHERE profileId = ? ORDER BY updatedAt DESC LIMIT ?', [getProfileId(), limit]) as StreamHistoryItem[];
}

/** Keys of titles / episodes that were watched to the end. */
export function listWatchedKeys(): string[] {
  return all('SELECT key FROM stream_history WHERE profileId = ? AND completed = 1', [getProfileId()]).map(r => r.key);
}

export function getStreamProgress(key: string): StreamHistoryItem | null {
  return one('SELECT * FROM stream_history WHERE profileId = ? AND key = ?', [getProfileId(), key]);
}

export function removeStreamHistory(key: string): void {
  run('DELETE FROM stream_history WHERE profileId = ? AND key = ?', [getProfileId(), key]);
  saveDb();
}

// ─── playlists ──────────────────────────────────────────────────────

export interface PlaylistSummary {
  id: number;
  name: string;
  count: number;
  posters: string[];   // up to four, for the mosaic
}

export interface PlaylistItem {
  key: string;         // local:<id> | yts:<id> | series:<id>
  kind: 'local' | 'yts' | 'series';
  title: string;
  year: number;
  poster: string;
  payload: string;     // JSON of the movie / show, used to reopen it
  addedAt: number;
}

export function listPlaylists(): PlaylistSummary[] {
  return all('SELECT id, name FROM playlists WHERE profileId = ? ORDER BY createdAt DESC, id DESC', [getProfileId()]).map(p => {
    const items = all('SELECT poster FROM playlist_items WHERE playlistId = ? ORDER BY addedAt DESC', [p.id]);
    return {
      id: p.id,
      name: p.name,
      count: items.length,
      posters: items.map(i => i.poster).filter(Boolean).slice(0, 4),
    };
  });
}

function cleanName(name: string): string {
  const n = (name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!n) throw new Error('Give the playlist a name');
  return n;
}

const ownsPlaylist = (id: number) => !!one('SELECT id FROM playlists WHERE id = ? AND profileId = ?', [id, getProfileId()]);

export function createPlaylist(name: string): PlaylistSummary {
  const n = cleanName(name);
  if (one('SELECT id FROM playlists WHERE profileId = ? AND name = ?', [getProfileId(), n])) throw new Error(`You already have a playlist called "${n}"`);
  run('INSERT INTO playlists (profileId, name, createdAt) VALUES (?, ?, ?)', [getProfileId(), n, now()]);
  const row = one('SELECT id FROM playlists WHERE profileId = ? AND name = ?', [getProfileId(), n]);
  saveDb();
  return { id: row.id, name: n, count: 0, posters: [] };
}

export function renamePlaylist(id: number, name: string): void {
  if (!ownsPlaylist(id)) throw new Error('Playlist not found');
  const n = cleanName(name);
  if (one('SELECT id FROM playlists WHERE profileId = ? AND name = ? AND id != ?', [getProfileId(), n, id])) throw new Error(`You already have a playlist called "${n}"`);
  run('UPDATE playlists SET name = ? WHERE id = ?', [n, id]);
  saveDb();
}

export function deletePlaylist(id: number): void {
  if (!ownsPlaylist(id)) return;
  run('DELETE FROM playlist_items WHERE playlistId = ?', [id]);
  run('DELETE FROM playlists WHERE id = ?', [id]);
  saveDb();
}

export function getPlaylistItems(id: number): PlaylistItem[] {
  if (!ownsPlaylist(id)) return [];
  return all('SELECT key, kind, title, year, poster, payload, addedAt FROM playlist_items WHERE playlistId = ? ORDER BY addedAt DESC', [id]) as PlaylistItem[];
}

export function addToPlaylist(playlistId: number, item: Omit<PlaylistItem, 'addedAt'>): void {
  if (!ownsPlaylist(playlistId)) throw new Error('Playlist not found');
  run(
    `INSERT OR REPLACE INTO playlist_items (playlistId, key, kind, title, year, poster, payload, addedAt) VALUES (?,?,?,?,?,?,?,?)`,
    [playlistId, item.key, item.kind, item.title, item.year || 0, item.poster || '', item.payload, now()]
  );
  saveDb();
}

export function removeFromPlaylist(playlistId: number, key: string): void {
  if (!ownsPlaylist(playlistId)) return;
  run('DELETE FROM playlist_items WHERE playlistId = ? AND key = ?', [playlistId, key]);
  saveDb();
}

/** Ids of this profile's playlists that already contain the item. */
export function playlistMembership(key: string): number[] {
  return all(
    `SELECT pi.playlistId FROM playlist_items pi JOIN playlists p ON p.id = pi.playlistId WHERE pi.key = ? AND p.profileId = ?`,
    [key, getProfileId()]
  ).map(r => r.playlistId);
}

// ─── followed shows ─────────────────────────────────────────────────

export interface FollowedShow { showId: number; title: string; poster: string; payload: string; addedAt: number }

export function listFollows(): FollowedShow[] {
  return all('SELECT showId, title, poster, payload, addedAt FROM follows WHERE profileId = ? ORDER BY addedAt DESC', [getProfileId()]) as FollowedShow[];
}

export function followShow(show: { showId: number; title: string; poster: string; payload: string }): void {
  run('INSERT OR REPLACE INTO follows (profileId, showId, title, poster, payload, addedAt) VALUES (?,?,?,?,?,?)',
    [getProfileId(), show.showId, show.title, show.poster || '', show.payload, now()]);
  saveDb();
}

export function unfollowShow(showId: number): void {
  run('DELETE FROM follows WHERE profileId = ? AND showId = ?', [getProfileId(), showId]);
  saveDb();
}

// ─── remembered choices (captions / audio per show or movie) ────────

export function getPref(scope: string): Record<string, unknown> | null {
  const row = one('SELECT data FROM prefs WHERE profileId = ? AND scope = ?', [getProfileId(), scope]);
  if (!row) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

export function setPref(scope: string, patch: Record<string, unknown>): void {
  const merged = { ...(getPref(scope) ?? {}), ...patch };
  run('INSERT OR REPLACE INTO prefs (profileId, scope, data) VALUES (?,?,?)', [getProfileId(), scope, JSON.stringify(merged)]);
  saveDb();
}

// ─── files this app downloaded (the only ones auto-delete may touch) ─

export function recordAppDownload(filePath: string): void {
  run('INSERT OR REPLACE INTO app_downloads (path, createdAt) VALUES (?, ?)', [filePath, now()]);
  saveDb();
}

export const isAppDownload = (filePath: string): boolean => !!one('SELECT path FROM app_downloads WHERE path = ?', [filePath]);

export function forgetAppDownload(filePath: string): void {
  run('DELETE FROM app_downloads WHERE path = ?', [filePath]);
  saveDb();
}
