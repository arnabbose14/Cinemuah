// Android implementation of window.electronAPI.
// The shared React UI (../src) talks to this object exactly as it does to Electron's preload bridge.
import { App as CapApp } from '@capacitor/app';
import type { DownloadInfo } from '../../src/types';
import { Native, isNative } from './native';
import { getSetting, setSetting } from './settings';
import { listYtsMovies, getYtsMovie, testYtsConnection } from './yts';
import { listSeries, getSeries } from './series';
import { library, invalidateLibrary } from './library';
import { profilesApi, historyApi, playlistsApi, followsApi, prefsApi } from './userdata';
import { subtitlesApi } from './subtitles';

const noop = async () => undefined;

const api = {
  window: { minimize: noop, maximize: noop, close: noop },

  media: { getPort: async () => (isNative ? (await Native.getPort()).port : 0) },

  settings: {
    get: async (key: string) => getSetting(key),
    set: async (key: string, value: string) => setSetting(key, value),
  },

  movies: {
    getAll: library.getAll,
    getById: library.getById,
    search: library.search,
    getByGenre: async () => [],
    getContinueWatching: library.getContinueWatching,
    getRecentlyAdded: library.getRecentlyAdded,
    getMyList: library.getMyList,
    getGenres: async () => [],
    getCount: library.getCount,
    update: noop,
    delete: library.remove,
  },

  progress: { update: library.updateProgress },
  mylist: { toggle: library.toggleMyList },

  library: {
    scan: library.scan,
    onScanProgress: () => undefined,
    onScanComplete: () => undefined,
    onScanError: () => undefined,
    removeScanListeners: () => undefined,
  },

  dialog: { selectFolder: async () => null },
  file: { exists: async () => true },
  metadata: { search: async () => null, fetch: async () => null, refreshMovie: async () => null },

  yts: {
    list: listYtsMovies,
    get: getYtsMovie,
    test: testYtsConnection,
  },

  series: { list: listSeries, get: getSeries },

  // Per-profile data and captions (same shapes as the desktop bridge)
  history: historyApi,
  playlists: playlistsApi,
  follows: followsApi,
  prefs: prefsApi,
  subtitles: subtitlesApi,
  profiles: {
    ...profilesApi,
    switch: async (id: number, pin?: string) => { const p = await profilesApi.switch(id, pin); invalidateLibrary(); return p; },
    delete: async (id: number) => { await profilesApi.delete(id); invalidateLibrary(); },
  },
  /** Trailers play from YouTube's embed directly (the phone has no local trailer page). */
  trailerUrl: (id: string) => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&modestbranding=1`,

  downloads: {
    start: (magnet: string, meta: Record<string, any>) =>
      Native.downloadStart({ magnet, title: meta.title, year: meta.year, quality: meta.quality, series: meta.series }),
    list: async () => (await Native.downloadsList()).items,
    cancel: (hash: string) => Native.downloadCancel({ hash }),
    pause: (hash: string) => Native.downloadPause({ hash }),
    resume: (hash: string) => Native.downloadResume({ hash }),
    clear: () => Native.downloadsClear(),
    onFinished: (callback: (info: DownloadInfo) => void) => {
      const handle = Native.addListener('downloadFinished', info => { library.scan().catch(() => undefined); callback(info); });
      return () => { handle.then(h => h.remove()).catch(() => undefined); };
    },
  },

  torrent: {
    start: (magnet: string) => Native.torrentStart({ magnet }),
    stats: async () => {
      const s = await Native.torrentStats();
      return s && s.active ? (s as any) : null;
    },
    stop: () => Native.torrentStop(),
  },

  shell: { openExternal: (url: string) => (isNative ? Native.openExternal({ url }) : Promise.resolve(void window.open(url, '_blank'))) },
};

(window as any).electronAPI = api;

if (isNative) {
  document.documentElement.classList.add('android');

  // Infinite scroll: the page scrolls inside .main-content, which clips children, so an observer on the
  // viewport only fires when the sentinel is actually on screen and its rootMargin is ignored. Rooting
  // every observer on the scroll container makes "load the next page early" work.
  const NativeIO = window.IntersectionObserver;
  (window as any).IntersectionObserver = class extends NativeIO {
    constructor(cb: IntersectionObserverCallback, opts: IntersectionObserverInit = {}) {
      super(cb, { ...opts, root: opts.root ?? document.querySelector('.main-content') });
    }
  };

  // Fullscreen = native immersive landscape mode (the WebView's own fullscreen API is not available)
  let fsElement: Element | null = null;
  const fire = () => document.dispatchEvent(new Event('fullscreenchange'));
  Object.defineProperty(document, 'fullscreenElement', { get: () => fsElement, configurable: true });
  (Element.prototype as any).requestFullscreen = async function (this: Element) {
    fsElement = this; Native.setPlayerMode({ on: true }).catch(() => undefined); fire();
  };
  (document as any).exitFullscreen = async () => {
    fsElement = null; Native.setPlayerMode({ on: false }).catch(() => undefined); fire();
  };

  // Landscape + immersive automatically while the player is on screen.
  // Checked at most once per frame so it stays cheap while the UI re-renders.
  let playerOpen = false;
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const open = !!document.querySelector('.player-overlay');
      if (open !== playerOpen) {
        playerOpen = open;
        if (!open) fsElement = null;
        Native.setPlayerMode({ on: open }).catch(() => undefined);
      }
    });
  }).observe(document.getElementById('root') || document.body, { childList: true, subtree: true });

  // The on-screen keyboard shrinks the viewport: hide the bottom tab bar while typing
  const baseHeight = window.innerHeight;
  window.addEventListener('resize', () => {
    document.documentElement.classList.toggle('keyboard-open', window.innerHeight < baseHeight * 0.75 && !playerOpen);
  });

  // Hardware back button: close the player / dialogs first, then go Home, and only then leave the app
  CapApp.addListener('backButton', () => {
    console.log('[cm] hardware Back; player=' + !!document.querySelector('.player-overlay') + ' dialog=' + !!document.querySelector('.movie-detail-overlay'));
    if (document.querySelector('.player-overlay')) {
      // The player ignores Escape while it believes it is fullscreen; on a phone Back should always leave it
      fsElement = null;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      // On the "Playback Error" screen the <video> is gone, so the player ignores Escape: use its own Back button
      setTimeout(() => {
        const overlay = document.querySelector('.player-overlay');
        if (!overlay) return;
        const buttons = Array.from(overlay.querySelectorAll<HTMLElement>('button'));
        const back = buttons.find(b => /back/i.test(b.textContent || '')) || buttons.find(b => /^close/i.test(b.title || '')) || buttons[0];
        back?.click();
      }, 250);
      return;
    }
    // "Who's watching?" / manage profiles: a PIN prompt or the editor goes back to the list, the list closes
    // (unless it is the required start-up picker, which has no close button: Back then simply leaves the app)
    const picker = document.querySelector<HTMLElement>('.profile-picker');
    if (picker) {
      const close = picker.querySelector<HTMLElement>('.detail-close');
      const cancel = Array.from(picker.querySelectorAll<HTMLElement>('button')).find(b => b.textContent?.trim() === 'Cancel');
      if (cancel) { cancel.click(); return; }
      if (close) { close.click(); return; }
      CapApp.exitApp();
      return;
    }
    // Details / season dialogs (the topmost one first, e.g. "Fix match" over a movie)
    const overlays = document.querySelectorAll<HTMLElement>('.movie-detail-overlay');
    if (overlays.length) { overlays[overlays.length - 1].click(); return; }
    const menuBackdrop = document.querySelector<HTMLElement>('.nav-menu-backdrop');
    if (menuBackdrop) { menuBackdrop.click(); return; }
    // A search box that still holds focus (and its suggestion list) must not swallow Back: drop the focus and carry on,
    // so one press always makes one step (search results -> Home, Home -> leave)
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName)) focused.blur();
    const active = document.querySelector('.navbar-nav .nav-link.active')?.textContent?.trim();
    if (active !== 'Home') {
      // Includes Settings, Downloads and search results, which have no active tab
      const home = Array.from(document.querySelectorAll<HTMLElement>('.navbar-nav .nav-link')).find(b => b.textContent?.trim() === 'Home');
      if (home) { home.click(); return; }
    }
    CapApp.exitApp();
  });
}