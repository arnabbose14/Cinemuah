export interface Movie {
  id: number;
  filePath: string;
  fileName: string;
  title: string;
  year: number | null;
  description: string;
  poster: string;
  backdrop: string;
  duration: number;
  rating: number;
  director: string;
  writers: string; // JSON string
  cast: string; // JSON string
  genres: string; // JSON string
  tmdbId: number | null;
  dateAdded: number;
  lastModified: number;
  fileSize: number;
  isInMyList: number;
  // Watch progress
  position?: number;
  lastPlayed?: number;
  watchCount?: number;
  completed?: number;
}

export interface CastMember {
  name: string;
  character: string;
  profilePhoto?: string;
}

export interface ScanProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

export interface ScanResult {
  totalFiles: number;
  newMovies: number;
  removedMovies: number;
  failedMovies: number;
  skippedMovies: number;
}

export type SortOption = 
  | 'dateAdded' 
  | 'title' 
  | 'year' 
  | 'rating' 
  | 'lastPlayed'
  | 'watchCount';

export type SortOrder = 'asc' | 'desc';

export interface MovieSearchResult {
  id: number;
  title: string;
  year?: number;
  poster?: string;
  overview?: string;
  rating?: number;
}

export interface YtsTorrent {
  quality: string;
  type: string;
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
  sortBy?: string;
  minimumRating?: number;
}

export interface YtsListResult {
  movies: YtsMovie[];
  total: number;
  page: number;
  limit: number;
}

export interface TorrentStreamInfo {
  infoHash: string;
  fileIndex: number;
  fileName: string;
  fileSize: number;
  streamPath: string;
}

export interface TorrentStats {
  infoHash: string;
  ready: boolean;
  progress: number;
  fileProgress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  downloaded: number;
  fileSize: number;
}

export type AppMode = 'online' | 'offline';

/** A streamed (online) title that was left part-way through. */
export interface StreamHistoryItem {
  key: string;
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
  genres: string;
  position: number;
  duration: number;
  completed: number;
  updatedAt: number;
}

export interface PlaylistSummary { id: number; name: string; count: number; posters: string[] }

export interface PlaylistItem {
  key: string;
  kind: 'local' | 'yts' | 'series';
  title: string;
  year: number;
  poster: string;
  payload: string;
  addedAt: number;
}

export interface SubtitleTrack {
  id: string;
  label: string;
  lang: string;
  source: 'file' | 'embedded' | 'online';
  detail?: string;
}

/** What the player needs to find captions for the title it is playing. */
export interface SubtitleContext {
  title: string;
  year?: number;
  imdbId?: string;
  season?: number;
  episode?: number;
  /** Local video path: enables sibling .srt files and embedded tracks. */
  filePath?: string;
}

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
  /** The episode list loaded but the torrent source could not be reached. */
  sourcesError?: string;
  /** Partial or saved data is being shown. */
  notice?: string;
}

export interface SeriesListResult {
  shows: SeriesShow[];
  total: number;
  page: number;
  limit: number;
}

/** Episode default: 1080p, else 720p, else best available; most seeds + peers wins within a quality. */
export function pickDefaultEpisodeTorrent(torrents: SeriesTorrent[]): SeriesTorrent | undefined {
  const live = torrents.filter(t => t.seeds > 0 || t.peers > 0);
  const score = (t: SeriesTorrent) => t.seeds * 2 + t.peers;
  const byScore = (a: SeriesTorrent, b: SeriesTorrent) => score(b) - score(a);
  for (const q of ['1080p', '720p']) {
    const match = live.filter(t => t.quality === q).sort(byScore)[0];
    if (match) return match;
  }
  return [...live].sort(byScore)[0];
}

export interface DownloadInfo {
  infoHash: string;
  title: string;
  year: number;
  quality: string;
  status: 'queued' | 'metadata' | 'downloading' | 'paused' | 'finalizing' | 'done' | 'error';
  progress: number;
  downloadSpeed: number;
  peers: number;
  downloaded: number;
  size: number;
  error?: string;
  savedPath?: string;
}

/** Default torrent: 1080p with the most peers, else 720p, else whatever has the most peers. */
export function pickDefaultTorrent(all: YtsTorrent[]): YtsTorrent | undefined {
  // Never default to a dead torrent while a live one exists
  const live = all.filter(t => t.peers > 0);
  const torrents = live.length > 0 ? live : all;
  const byPeers = (a: YtsTorrent, b: YtsTorrent) => (b.peers - a.peers) || (b.seeds - a.seeds);
  for (const q of ['1080p', '720p']) {
    const match = torrents.filter(t => t.quality === q).sort(byPeers)[0];
    if (match) return match;
  }
  return [...torrents].sort(byPeers)[0];
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Parse helpers
export function parseMovieGenres(genres: string): string[] {
  try {
    const parsed = JSON.parse(genres);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return genres ? genres.split(',').map(g => g.trim()) : [];
  }
}

export function parseMovieCast(cast: string): CastMember[] {
  try {
    const parsed = JSON.parse(cast);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseMovieWriters(writers: string): string[] {
  try {
    const parsed = JSON.parse(writers);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return writers ? writers.split(',').map(w => w.trim()) : [];
  }
}

export function formatDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function getProgressPercent(position?: number, duration?: number): number {
  if (!position || !duration || duration === 0) return 0;
  return Math.min((position / duration) * 100, 100);
}

export interface CastDevice { id: string; name: string; kind: 'chromecast' | 'dlna'; host: string }

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
export interface Profile { id: number; name: string; color: string; avatar: number; kids: boolean; hasPin: boolean }

export interface FollowedShow { showId: number; title: string; poster: string; payload: string; addedAt: number }

export interface AudioTrackInfo { ord: number; lang: string; codec: string; title: string }
export interface ChapterInfo { start: number; end: number; title: string }
