import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import path from 'path';
import dns from 'dns';

// Some networks answer with IPv6 addresses that never connect. Trying IPv4 first avoids 10 s connect stalls.
dns.setDefaultResultOrder('ipv4first');
import { initDatabase, getDb, flushDb } from './database';
import { startMediaServer, stopMediaServer } from './media-server';
import { initCast, discoverDevices, startCast, castStatus, castControl, stopCast, shutdownCast } from './cast-service';
import { initTranscoder } from './transcoder';
import { listSeries, getSeries, prefetchSeries, SeriesListOptions } from './series-service';
import {
  initUserData, saveStreamProgress, listStreamHistory, getStreamProgress, removeStreamHistory,
  listPlaylists, createPlaylist, renamePlaylist, deletePlaylist, getPlaylistItems, addToPlaylist,
  removeFromPlaylist, playlistMembership,
  listAllStreamHistory, listWatchedKeys, listProfiles, getActiveProfile, createProfile, updateProfile, deleteProfile, switchProfile, verifyPin,
  listFollows, followShow, unfollowShow, getPref, setPref, isAppDownload, forgetAppDownload,
} from './user-data';
import { listLocalTracks, searchOnline, loadTrack, pickSubtitleFile, saveSubtitleBesideVideo, OnlineQuery } from './subtitles-service';
import { scanLibrary } from './scanner';
import { 
  getMovies, getMovieById, updateMovie, searchMovies, 
  getMoviesByGenre, getContinueWatching, getRecentlyAdded,
  updateWatchProgress, toggleMyList, getMyList, getGenres,
  getMovieCount, deleteMovie, getSettings, setSetting
} from './movie-store';
import { fetchMovieMetadata, searchMovieMetadata } from './metadata-service';
import { listYtsMovies, getYtsMovie, setYtsMirror, testYtsConnection, prefetchYts, YtsListOptions } from './yts-service';
import {
  startTorrent, stopTorrent, getTorrentStats, destroyTorrentClient,
  startDownload, getDownloads, cancelDownload, pauseDownload, resumeDownload,
  clearFinishedDownloads, setDownloadFinishedHandler, DownloadMeta,
  applyDownloadLimits,
} from './torrent-service';
import fs from 'fs';

// Own Windows app identity: the taskbar then shows this app's icon instead of Electron's
app.setAppUserModelId('com.cinelocal.app');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let mediaServerPort = 0;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    icon: path.join(__dirname, '../../dist', process.platform === 'win32' ? 'cinemuah.ico' : 'icon.png'),
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const distIndex = path.join(__dirname, '../../dist/index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else if (fs.existsSync(distIndex)) {
    mainWindow.loadFile(distIndex);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Initialize database
  await initDatabase();
  initUserData();

  initTranscoder();
  setYtsMirror(getSettings('ytsMirror') || '');
  prefetchYts(); // warm title/poster caches in the background
  prefetchSeries();

  // Start media server
  mediaServerPort = await startMediaServer();
  console.log(`Media server started on port ${mediaServerPort}`);
  initCast(mediaServerPort);

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopMediaServer();
  if (process.platform !== 'darwin') app.quit();
});

let torrentCleanedUp = false;
app.on('before-quit', (event) => {
  flushDb(); // pending coalesced writes must reach the disk
  if (torrentCleanedUp) return;
  event.preventDefault();
  torrentCleanedUp = true;
  shutdownCast();
  destroyTorrentClient().finally(() => app.quit());
});

// --- IPC Handlers ---

// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized());

// Casting to TVs (Chromecast + DLNA)
ipcMain.handle('cast:devices', () => discoverDevices());
ipcMain.handle('cast:start', (_e, opts) => startCast(opts));
ipcMain.handle('cast:status', () => castStatus());
ipcMain.handle('cast:control', (_e, action, value) => castControl(action, value));
ipcMain.handle('cast:stop', () => stopCast());

// Media server info
ipcMain.handle('media:getPort', () => mediaServerPort);

// Settings
ipcMain.handle('settings:get', (_event, key: string) => getSettings(key));
ipcMain.handle('settings:set', (_event, key: string, value: string) => {
  setSetting(key, value);
  if (key === 'downloadLimitKBps' || key === 'maxConcurrentDownloads') applyDownloadLimits();
});

// Movies
ipcMain.handle('movies:getAll', (_event, options?: { sortBy?: string; order?: string }) => 
  getMovies(options));
ipcMain.handle('movies:getById', (_event, id: number) => getMovieById(id));
ipcMain.handle('movies:search', (_event, query: string) => searchMovies(query));
ipcMain.handle('movies:getByGenre', (_event, genre: string, options?: { sortBy?: string; order?: string }) => 
  getMoviesByGenre(genre, options));
ipcMain.handle('movies:getContinueWatching', () => getContinueWatching());
ipcMain.handle('movies:getRecentlyAdded', () => getRecentlyAdded());
ipcMain.handle('movies:getMyList', () => getMyList());
ipcMain.handle('movies:getGenres', () => getGenres());
ipcMain.handle('movies:getCount', () => getMovieCount());
ipcMain.handle('movies:update', (_event, id: number, data: Record<string, unknown>) => updateMovie(id, data));
ipcMain.handle('movies:delete', (_event, id: number) => deleteMovie(id));

// Watch progress
ipcMain.handle('progress:update', (_event, movieId: number, position: number, duration: number) => 
  updateWatchProgress(movieId, position, duration));

// My List
ipcMain.handle('mylist:toggle', (_event, movieId: number) => toggleMyList(movieId));

// Library scanning
ipcMain.handle('library:scan', async (_event, folder?: string) => {
  const moviesFolder = folder || getSettings('moviesFolder') || 'E:\\Personal\\Movies';
  
  const sendProgress = (data: { phase: string; current: number; total: number; message: string }) => {
    mainWindow?.webContents.send('library:scanProgress', data);
  };
  
  try {
    const result = await scanLibrary(moviesFolder, sendProgress);
    mainWindow?.webContents.send('library:scanComplete', result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    mainWindow?.webContents.send('library:scanError', { message });
    throw error;
  }
});

// Folder selection
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'Select Movie Folder',
  });
  return result.filePaths[0] || null;
});

// File validation
ipcMain.handle('file:exists', (_event, filePath: string) => {
  return fs.existsSync(filePath);
});

// Metadata
ipcMain.handle('metadata:search', async (_event, title: string, year?: number) => {
  const apiKey = getSettings('tmdbApiKey') || '';
  return searchMovieMetadata(title, year, apiKey);
});

ipcMain.handle('metadata:fetch', async (_event, tmdbId: number) => {
  const apiKey = getSettings('tmdbApiKey') || '';
  return fetchMovieMetadata(tmdbId, apiKey);
});

ipcMain.handle('metadata:refreshMovie', async (_event, movieId: number) => {
  const movie = getMovieById(movieId);
  if (!movie) return null;
  
  const apiKey = getSettings('tmdbApiKey') || '';
  if (!apiKey) return null;
  
  // Parse title and year from filename
  const titleMatch = movie.title.match(/^(.+?)\s*(?:\((\d{4})\))?$/);
  const title = titleMatch ? titleMatch[1].trim() : movie.title;
  const year = titleMatch && titleMatch[2] ? parseInt(titleMatch[2]) : undefined;
  
  const results = await searchMovieMetadata(title, year, apiKey);
  if (results && results.length > 0) {
    const metadata = await fetchMovieMetadata(results[0].id, apiKey);
    if (metadata) {
      updateMovie(movieId, {
        title: metadata.title,
        year: metadata.year,
        description: metadata.description,
        poster: metadata.poster,
        backdrop: metadata.backdrop,
        rating: metadata.rating,
        duration: metadata.duration,
        genres: metadata.genres,
        cast: metadata.cast,
        director: metadata.director,
        writers: metadata.writers,
        tmdbId: metadata.tmdbId,
      });
      return getMovieById(movieId);
    }
  }
  return null;
});

// YTS discovery
ipcMain.handle('yts:list', (_event, options?: YtsListOptions) => {
  setYtsMirror(getSettings('ytsMirror') || '');
  return listYtsMovies(options);
});
ipcMain.handle('yts:test', () => {
  setYtsMirror(getSettings('ytsMirror') || '');
  return testYtsConnection();
});
ipcMain.handle('yts:get', (_event, id: number) => {
  setYtsMirror(getSettings('ytsMirror') || '');
  return getYtsMovie(id);
});

// Watch history for streamed titles (Continue Watching)
ipcMain.handle('history:save', (_event, item) => saveStreamProgress(item));
ipcMain.handle('history:list', () => listStreamHistory());
ipcMain.handle('history:get', (_event, key: string) => getStreamProgress(key));
ipcMain.handle('history:remove', (_event, key: string) => removeStreamHistory(key));

ipcMain.handle('history:watched', () => listWatchedKeys());
ipcMain.handle('history:all', () => listAllStreamHistory());

// Profiles
ipcMain.handle('profiles:list', () => listProfiles());
ipcMain.handle('profiles:active', () => getActiveProfile());
ipcMain.handle('profiles:create', (_event, p) => createProfile(p));
ipcMain.handle('profiles:update', (_event, id: number, p) => updateProfile(id, p));
ipcMain.handle('profiles:delete', (_event, id: number) => deleteProfile(id));
ipcMain.handle('profiles:switch', (_event, id: number, pin?: string) => switchProfile(id, pin));
ipcMain.handle('profiles:verify', (_event, id: number, pin: string) => verifyPin(id, pin));

// Followed shows + remembered caption / audio choices
ipcMain.handle('follows:list', () => listFollows());
ipcMain.handle('follows:follow', (_event, show) => followShow(show));
ipcMain.handle('follows:unfollow', (_event, showId: number) => unfollowShow(showId));
ipcMain.handle('prefs:get', (_event, scope: string) => getPref(scope));
ipcMain.handle('prefs:set', (_event, scope: string, patch) => setPref(scope, patch));

// Library tools: move a file to the Recycle Bin, and tidy up after watching
async function trashMovie(movieId: number): Promise<boolean> {
  const movie = getMovieById(movieId);
  if (!movie) return false;
  const folder = getSettings('moviesFolder') || 'E:\\Personal\\Movies';
  const norm = (p: string) => path.resolve(p).toLowerCase();
  if (!norm(movie.filePath).startsWith(norm(folder))) throw new Error('That file is outside your movie folder, so it was left alone.');
  if (fs.existsSync(movie.filePath)) await shell.trashItem(movie.filePath);
  // subtitles this app saved next to a download (Name.en.vtt) go with it
  try {
    const dir = path.dirname(movie.filePath);
    const base = path.basename(movie.filePath, path.extname(movie.filePath));
    if (isAppDownload(movie.filePath)) {
      for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '.') && f.endsWith('.vtt')) await shell.trashItem(path.join(dir, f));
    }
  } catch { /* leave them */ }
  forgetAppDownload(movie.filePath);
  deleteMovie(movieId);
  return true;
}
ipcMain.handle('library:trash', (_event, movieId: number) => trashMovie(movieId));
// Only files this app downloaded, only when the user turned the setting on, and only once watched to the end
ipcMain.handle('library:cleanupWatched', async (_event, movieId: number) => {
  if (getSettings('autoDeleteWatched') !== 'true') return null;
  const movie = getMovieById(movieId);
  if (!movie || !movie.completed || !isAppDownload(movie.filePath)) return null;
  const title = movie.title;
  return (await trashMovie(movieId)) ? title : null;
});

// Playlists
ipcMain.handle('playlists:list', () => listPlaylists());
ipcMain.handle('playlists:create', (_event, name: string) => createPlaylist(name));
ipcMain.handle('playlists:rename', (_event, id: number, name: string) => renamePlaylist(id, name));
ipcMain.handle('playlists:delete', (_event, id: number) => deletePlaylist(id));
ipcMain.handle('playlists:items', (_event, id: number) => getPlaylistItems(id));
ipcMain.handle('playlists:add', (_event, id: number, item) => addToPlaylist(id, item));
ipcMain.handle('playlists:remove', (_event, id: number, key: string) => removeFromPlaylist(id, key));
ipcMain.handle('playlists:membership', (_event, key: string) => playlistMembership(key));

// Captions
ipcMain.handle('subtitles:local', (_event, moviePath: string) => listLocalTracks(moviePath));
ipcMain.handle('subtitles:search', (_event, query: OnlineQuery) => searchOnline(query));
ipcMain.handle('subtitles:load', (_event, id: string) => loadTrack(id));
ipcMain.handle('subtitles:pickFile', () => pickSubtitleFile(mainWindow));

// Series (TVMaze + EZTV)
ipcMain.handle('series:list', (_event, options?: SeriesListOptions) => listSeries(options));
ipcMain.handle('series:get', (_event, id: number) => getSeries(id));

// Downloads (saved into the movie library folder)
const getLibraryRoot = () => getSettings('moviesFolder') || 'E:\\Personal\\Movies';

setDownloadFinishedHandler(async (info) => {
  try {
    await scanLibrary(getLibraryRoot(), () => undefined);
  } catch (err) {
    console.error('[downloads] rescan failed:', err);
  }
  // Save a matching subtitle next to the video so captions work offline too
  if (info.savedPath && getSettings('autoSubtitles') !== 'false') {
    await saveSubtitleBesideVideo(info.savedPath, {
      imdbId: info.imdbId, title: info.series?.showTitle || info.title, year: info.year,
      season: info.series?.season, episode: info.series?.episode,
    }, getSettings('subtitleLanguage') || 'en');
  }
  mainWindow?.webContents.send('downloads:finished', info);
});

ipcMain.handle('downloads:start', (_event, magnet: string, meta: DownloadMeta) => {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:?xt=urn:btih:')) throw new Error('Invalid magnet link');
  const root = getLibraryRoot();
  if (!fs.existsSync(root)) throw new Error(`Movie folder not found: ${root}. Set it in Settings.`);
  return startDownload(magnet, meta, root);
});
ipcMain.handle('downloads:list', () => getDownloads());
ipcMain.handle('downloads:cancel', (_event, hash: string) => cancelDownload(hash));
ipcMain.handle('downloads:pause', (_event, hash: string) => pauseDownload(hash));
ipcMain.handle('downloads:resume', (_event, hash: string) => resumeDownload(hash));
ipcMain.handle('downloads:clear', () => clearFinishedDownloads());

// Torrent streaming
ipcMain.handle('torrent:start', (_event, magnet: string) => {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:?xt=urn:btih:')) {
    throw new Error('Invalid magnet link');
  }
  return startTorrent(magnet);
});
ipcMain.handle('torrent:stats', () => getTorrentStats());
ipcMain.handle('torrent:stop', () => stopTorrent());

// Open external URL
ipcMain.handle('shell:openExternal', (_event, url: string) => {
  shell.openExternal(url);
});

