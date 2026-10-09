import { contextBridge, ipcRenderer } from 'electron';

// Expose safe IPC API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const handler = (_e: unknown, v: boolean) => cb(v);
      ipcRenderer.on('window:maximized', handler);
      return () => { ipcRenderer.removeListener('window:maximized', handler); };
    },
  },

  // Media server
  media: {
    getPort: () => ipcRenderer.invoke('media:getPort'),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  // Movies
  movies: {
    getAll: (options?: { sortBy?: string; order?: string }) => 
      ipcRenderer.invoke('movies:getAll', options),
    getById: (id: number) => ipcRenderer.invoke('movies:getById', id),
    search: (query: string) => ipcRenderer.invoke('movies:search', query),
    getByGenre: (genre: string, options?: { sortBy?: string; order?: string }) => 
      ipcRenderer.invoke('movies:getByGenre', genre, options),
    getContinueWatching: () => ipcRenderer.invoke('movies:getContinueWatching'),
    getRecentlyAdded: () => ipcRenderer.invoke('movies:getRecentlyAdded'),
    getMyList: () => ipcRenderer.invoke('movies:getMyList'),
    getGenres: () => ipcRenderer.invoke('movies:getGenres'),
    getCount: () => ipcRenderer.invoke('movies:getCount'),
    update: (id: number, data: Record<string, unknown>) => 
      ipcRenderer.invoke('movies:update', id, data),
    delete: (id: number) => ipcRenderer.invoke('movies:delete', id),
  },

  // Watch progress
  progress: {
    update: (movieId: number, position: number, duration: number) => 
      ipcRenderer.invoke('progress:update', movieId, position, duration),
  },

  // My List
  mylist: {
    toggle: (movieId: number) => ipcRenderer.invoke('mylist:toggle', movieId),
  },

  // Library
  library: {
    scan: (folder?: string) => ipcRenderer.invoke('library:scan', folder),
    trash: (movieId: number) => ipcRenderer.invoke('library:trash', movieId),
    cleanupWatched: (movieId: number) => ipcRenderer.invoke('library:cleanupWatched', movieId),
    onScanProgress: (callback: (data: { phase: string; current: number; total: number; message: string }) => void) => {
      ipcRenderer.on('library:scanProgress', (_event, data) => callback(data));
    },
    onScanComplete: (callback: (result: unknown) => void) => {
      ipcRenderer.on('library:scanComplete', (_event, result) => callback(result));
    },
    onScanError: (callback: (error: { message: string }) => void) => {
      ipcRenderer.on('library:scanError', (_event, error) => callback(error));
    },
    removeScanListeners: () => {
      ipcRenderer.removeAllListeners('library:scanProgress');
      ipcRenderer.removeAllListeners('library:scanComplete');
      ipcRenderer.removeAllListeners('library:scanError');
    },
  },

  // Dialog
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  },

  // File system
  file: {
    exists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  },

  // Metadata
  metadata: {
    search: (title: string, year?: number) => ipcRenderer.invoke('metadata:search', title, year),
    fetch: (tmdbId: number) => ipcRenderer.invoke('metadata:fetch', tmdbId),
    refreshMovie: (movieId: number) => ipcRenderer.invoke('metadata:refreshMovie', movieId),
  },

  // YTS discovery
  yts: {
    list: (options?: Record<string, unknown>) => ipcRenderer.invoke('yts:list', options),
    get: (id: number) => ipcRenderer.invoke('yts:get', id),
    test: () => ipcRenderer.invoke('yts:test'),
  },

  // Watch history for streamed titles
  history: {
    save: (item: Record<string, unknown>) => ipcRenderer.invoke('history:save', item),
    list: () => ipcRenderer.invoke('history:list'),
    get: (key: string) => ipcRenderer.invoke('history:get', key),
    remove: (key: string) => ipcRenderer.invoke('history:remove', key),
    watched: () => ipcRenderer.invoke('history:watched'),
    all: () => ipcRenderer.invoke('history:all'),
  },

  // Playlists
  playlists: {
    list: () => ipcRenderer.invoke('playlists:list'),
    create: (name: string) => ipcRenderer.invoke('playlists:create', name),
    rename: (id: number, name: string) => ipcRenderer.invoke('playlists:rename', id, name),
    delete: (id: number) => ipcRenderer.invoke('playlists:delete', id),
    items: (id: number) => ipcRenderer.invoke('playlists:items', id),
    add: (id: number, item: Record<string, unknown>) => ipcRenderer.invoke('playlists:add', id, item),
    remove: (id: number, key: string) => ipcRenderer.invoke('playlists:remove', id, key),
    membership: (key: string) => ipcRenderer.invoke('playlists:membership', key),
  },

  // Captions
  subtitles: {
    local: (moviePath: string) => ipcRenderer.invoke('subtitles:local', moviePath),
    search: (query: Record<string, unknown>) => ipcRenderer.invoke('subtitles:search', query),
    load: (id: string) => ipcRenderer.invoke('subtitles:load', id),
    pickFile: () => ipcRenderer.invoke('subtitles:pickFile'),
  },

  // Profiles, followed shows, remembered choices
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    active: () => ipcRenderer.invoke('profiles:active'),
    create: (p: Record<string, unknown>) => ipcRenderer.invoke('profiles:create', p),
    update: (id: number, p: Record<string, unknown>) => ipcRenderer.invoke('profiles:update', id, p),
    delete: (id: number) => ipcRenderer.invoke('profiles:delete', id),
    switch: (id: number, pin?: string) => ipcRenderer.invoke('profiles:switch', id, pin),
    verify: (id: number, pin: string) => ipcRenderer.invoke('profiles:verify', id, pin),
  },
  follows: {
    list: () => ipcRenderer.invoke('follows:list'),
    follow: (show: Record<string, unknown>) => ipcRenderer.invoke('follows:follow', show),
    unfollow: (showId: number) => ipcRenderer.invoke('follows:unfollow', showId),
  },
  prefs: {
    get: (scope: string) => ipcRenderer.invoke('prefs:get', scope),
    set: (scope: string, patch: Record<string, unknown>) => ipcRenderer.invoke('prefs:set', scope, patch),
  },

  // Casting to TVs
  cast: {
    devices: () => ipcRenderer.invoke('cast:devices'),
    start: (opts: Record<string, unknown>) => ipcRenderer.invoke('cast:start', opts),
    status: () => ipcRenderer.invoke('cast:status'),
    control: (action: string, value?: number) => ipcRenderer.invoke('cast:control', action, value),
    stop: () => ipcRenderer.invoke('cast:stop'),
  },

  // Series
  series: {
    list: (options?: Record<string, unknown>) => ipcRenderer.invoke('series:list', options),
    get: (id: number) => ipcRenderer.invoke('series:get', id),
  },

  // Downloads
  downloads: {
    start: (magnet: string, meta: Record<string, unknown>) =>
      ipcRenderer.invoke('downloads:start', magnet, meta),
    list: () => ipcRenderer.invoke('downloads:list'),
    cancel: (hash: string) => ipcRenderer.invoke('downloads:cancel', hash),
    pause: (hash: string) => ipcRenderer.invoke('downloads:pause', hash),
    resume: (hash: string) => ipcRenderer.invoke('downloads:resume', hash),
    clear: () => ipcRenderer.invoke('downloads:clear'),
    onFinished: (callback: (info: unknown) => void) => {
      const handler = (_event: unknown, info: unknown) => callback(info);
      ipcRenderer.on('downloads:finished', handler);
      return () => ipcRenderer.removeListener('downloads:finished', handler);
    },
  },

  // Torrent streaming
  torrent: {
    start: (magnet: string) => ipcRenderer.invoke('torrent:start', magnet),
    stats: () => ipcRenderer.invoke('torrent:stats'),
    stop: () => ipcRenderer.invoke('torrent:stop'),
  },

  // Shell
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
});
