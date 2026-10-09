// Type definitions for the Electron API exposed via preload/contextBridge
import type {
  Movie, ScanProgress, ScanResult, MovieSearchResult,
  YtsListOptions, YtsListResult, YtsMovie, TorrentStreamInfo, TorrentStats, DownloadInfo,
  SeriesDetail, SeriesListResult, StreamHistoryItem, PlaylistSummary, PlaylistItem, SubtitleTrack,
  CastDevice, CastStatus, Profile, FollowedShow,
} from '@/types';

export interface ElectronAPI {
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    isMaximized?: () => Promise<boolean>;
    onMaximizeChange?: (cb: (maximized: boolean) => void) => () => void;
    close: () => Promise<void>;
  };
  media: {
    getPort: () => Promise<number>;
  };
  settings: {
    get: (key: string) => Promise<string>;
    set: (key: string, value: string) => Promise<void>;
  };
  movies: {
    getAll: (options?: { sortBy?: string; order?: string }) => Promise<Movie[]>;
    getById: (id: number) => Promise<Movie | null>;
    search: (query: string) => Promise<Movie[]>;
    getByGenre: (genre: string, options?: { sortBy?: string; order?: string }) => Promise<Movie[]>;
    getContinueWatching: () => Promise<Movie[]>;
    getRecentlyAdded: () => Promise<Movie[]>;
    getMyList: () => Promise<Movie[]>;
    getGenres: () => Promise<string[]>;
    getCount: () => Promise<number>;
    update: (id: number, data: Record<string, unknown>) => Promise<void>;
    delete: (id: number) => Promise<void>;
  };
  progress: {
    update: (movieId: number, position: number, duration: number) => Promise<void>;
  };
  mylist: {
    toggle: (movieId: number) => Promise<boolean>;
  };
  library: {
    scan: (folder?: string) => Promise<ScanResult>;
    trash?: (movieId: number) => Promise<boolean>;
    cleanupWatched?: (movieId: number) => Promise<string | null>;
    onScanProgress: (callback: (data: ScanProgress) => void) => void;
    onScanComplete: (callback: (result: ScanResult) => void) => void;
    onScanError: (callback: (error: { message: string }) => void) => void;
    removeScanListeners: () => void;
  };
  dialog: {
    selectFolder: () => Promise<string | null>;
  };
  file: {
    exists: (filePath: string) => Promise<boolean>;
  };
  metadata: {
    search: (title: string, year?: number) => Promise<MovieSearchResult[] | null>;
    fetch: (tmdbId: number) => Promise<unknown>;
    refreshMovie: (movieId: number) => Promise<Movie | null>;
  };
  yts: {
    list: (options?: YtsListOptions) => Promise<YtsListResult>;
    get: (id: number) => Promise<YtsMovie | null>;
    test: () => Promise<{ ok: boolean; host?: string; ms?: number; error?: string }>;
  };
  /** Optional: only the desktop app provides these; the UI hides the features when they are missing. */
  history?: {
    save: (item: Omit<StreamHistoryItem, 'completed' | 'updatedAt'>) => Promise<void>;
    list: () => Promise<StreamHistoryItem[]>;
    get: (key: string) => Promise<StreamHistoryItem | null>;
    remove: (key: string) => Promise<void>;
    watched: () => Promise<string[]>;
    all: () => Promise<StreamHistoryItem[]>;
  };
  profiles?: {
    list: () => Promise<Profile[]>;
    active: () => Promise<Profile>;
    create: (p: { name: string; color?: string; avatar?: number; kids?: boolean; pin?: string }) => Promise<Profile>;
    update: (id: number, p: { name?: string; color?: string; avatar?: number; kids?: boolean; pin?: string | null }) => Promise<void>;
    delete: (id: number) => Promise<void>;
    switch: (id: number, pin?: string) => Promise<Profile>;
    verify: (id: number, pin: string) => Promise<boolean>;
  };
  follows?: {
    list: () => Promise<FollowedShow[]>;
    follow: (show: { showId: number; title: string; poster: string; payload: string }) => Promise<void>;
    unfollow: (showId: number) => Promise<void>;
  };
  prefs?: {
    get: (scope: string) => Promise<Record<string, any> | null>;
    set: (scope: string, patch: Record<string, unknown>) => Promise<void>;
  };
  playlists?: {
    list: () => Promise<PlaylistSummary[]>;
    create: (name: string) => Promise<PlaylistSummary>;
    rename: (id: number, name: string) => Promise<void>;
    delete: (id: number) => Promise<void>;
    items: (id: number) => Promise<PlaylistItem[]>;
    add: (id: number, item: Omit<PlaylistItem, 'addedAt'>) => Promise<void>;
    remove: (id: number, key: string) => Promise<void>;
    membership: (key: string) => Promise<number[]>;
  };
  subtitles?: {
    local: (moviePath: string) => Promise<SubtitleTrack[]>;
    search: (query: {
      imdbId?: string; season?: number; episode?: number; title?: string; year?: number; languages: string[];
    }) => Promise<SubtitleTrack[]>;
    load: (id: string) => Promise<{ label: string; vtt: string }>;
    pickFile: () => Promise<{ label: string; vtt: string } | null>;
  };
  /** Where a YouTube trailer can be embedded from (the desktop app serves its own page instead). */
  trailerUrl?: (id: string) => string;
  cast?: {
    devices: () => Promise<CastDevice[]>;
    start: (opts: {
      deviceId: string; target: string; title: string; start: number; vtt?: string;
    }) => Promise<{ mode: 'direct' | 'transcode'; duration: number; deviceName: string }>;
    status: () => Promise<CastStatus>;
    control: (action: 'play' | 'pause' | 'seek' | 'volume' | 'mute' | 'stop', value?: number) => Promise<void>;
    stop: () => Promise<void>;
  };
  series: {
    list: (options?: { query?: string; page?: number; limit?: number }) => Promise<SeriesListResult>;
    get: (id: number) => Promise<SeriesDetail>;
  };
  downloads: {
    start: (
      magnet: string,
      meta: {
        title: string;
        year: number;
        quality: string;
        imdbId?: string;
        series?: { showTitle: string; season: number; episode: number };
      }
    ) => Promise<DownloadInfo>;
    list: () => Promise<DownloadInfo[]>;
    cancel: (hash: string) => Promise<void>;
    pause: (hash: string) => Promise<void>;
    resume: (hash: string) => Promise<void>;
    clear: () => Promise<void>;
    onFinished: (callback: (info: DownloadInfo) => void) => () => void;
  };
  torrent: {
    start: (magnet: string) => Promise<TorrentStreamInfo>;
    stats: () => Promise<TorrentStats | null>;
    stop: () => Promise<void>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
