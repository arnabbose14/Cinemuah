// Universal client adapter: works in both Electron and Browser
const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.movies;

export const clientAPI = {
  window: {
    minimize: async () => isElectron ? (window as any).electronAPI.window.minimize() : undefined,
    maximize: async () => isElectron ? (window as any).electronAPI.window.maximize() : undefined,
    close: async () => isElectron ? (window as any).electronAPI.window.close() : undefined,
  },
  media: {
    getPort: async () => {
      if (isElectron) return (window as any).electronAPI.media.getPort();
      const res = await fetch('/api/media/port');
      const data = await res.json();
      return data.port;
    },
  },
  settings: {
    get: async (key: string) => {
      if (isElectron) return (window as any).electronAPI.settings.get(key);
      const res = await fetch(`/api/settings/${key}`);
      const data = await res.json();
      return data.value || '';
    },
    set: async (key: string, value: string) => {
      if (isElectron) return (window as any).electronAPI.settings.set(key, value);
      await fetch(`/api/settings/${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
    },
  },
  movies: {
    getAll: async (options?: { sortBy?: string; order?: string }) => {
      if (isElectron) return (window as any).electronAPI.movies.getAll(options);
      const res = await fetch(`/api/movies?sortBy=${options?.sortBy || 'dateAdded'}&order=${options?.order || 'desc'}`);
      return res.json();
    },
    getById: async (id: number) => {
      if (isElectron) return (window as any).electronAPI.movies.getById(id);
      const res = await fetch(`/api/movies/${id}`);
      return res.json();
    },
    search: async (query: string) => {
      if (isElectron) return (window as any).electronAPI.movies.search(query);
      const res = await fetch(`/api/movies/search?q=${encodeURIComponent(query)}`);
      return res.json();
    },
    getByGenre: async (genre: string) => {
      if (isElectron) return (window as any).electronAPI.movies.getByGenre(genre);
      const res = await fetch(`/api/movies/genre/${encodeURIComponent(genre)}`);
      return res.json();
    },
    getContinueWatching: async () => {
      if (isElectron) return (window as any).electronAPI.movies.getContinueWatching();
      const res = await fetch('/api/movies/continue');
      return res.json();
    },
    getRecentlyAdded: async () => {
      if (isElectron) return (window as any).electronAPI.movies.getRecentlyAdded();
      const res = await fetch('/api/movies/recent');
      return res.json();
    },
    getMyList: async () => {
      if (isElectron) return (window as any).electronAPI.movies.getMyList();
      const res = await fetch('/api/movies/mylist');
      return res.json();
    },
    getGenres: async () => {
      if (isElectron) return (window as any).electronAPI.movies.getGenres();
      const res = await fetch('/api/movies/genres');
      return res.json();
    },
    getCount: async () => {
      if (isElectron) return (window as any).electronAPI.movies.getCount();
      const res = await fetch('/api/movies/count');
      const data = await res.json();
      return data.count;
    },
    update: async (id: number, data: Record<string, unknown>) => {
      if (isElectron) return (window as any).electronAPI.movies.update(id, data);
    },
    delete: async (id: number) => {
      if (isElectron) return (window as any).electronAPI.movies.delete(id);
    },
  },
  progress: {
    update: async (movieId: number, position: number, duration: number) => {
      if (isElectron) return (window as any).electronAPI.progress.update(movieId, position, duration);
      await fetch(`/api/movies/${movieId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, duration }),
      });
    },
  },
  mylist: {
    toggle: async (movieId: number) => {
      if (isElectron) return (window as any).electronAPI.mylist.toggle(movieId);
      const res = await fetch(`/api/movies/${movieId}/mylist`, { method: 'POST' });
      const data = await res.json();
      return data.isInMyList;
    },
  },
  library: {
    scan: async (folder?: string) => {
      if (isElectron) return (window as any).electronAPI.library.scan(folder);
      const res = await fetch('/api/library/scan', { method: 'POST' });
      return res.json();
    },
    onScanProgress: (callback: any) => {
      if (isElectron) (window as any).electronAPI.library.onScanProgress(callback);
    },
    onScanComplete: (callback: any) => {
      if (isElectron) (window as any).electronAPI.library.onScanComplete(callback);
    },
    onScanError: (callback: any) => {
      if (isElectron) (window as any).electronAPI.library.onScanError(callback);
    },
    removeScanListeners: () => {
      if (isElectron) (window as any).electronAPI.library.removeScanListeners();
    },
  },
  dialog: {
    selectFolder: async () => isElectron ? (window as any).electronAPI.dialog.selectFolder() : null,
  },
  file: {
    exists: async (filePath: string) => true,
  },
  metadata: {
    search: async () => null,
    fetch: async () => null,
    refreshMovie: async () => null,
  },
  shell: {
    openExternal: (url: string) => window.open(url, '_blank'),
  },
};
