// Torrent streaming engine built on WebTorrent.
// Only one stream is active at a time; starting a new one tears down the previous one.
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import type { Readable } from 'stream';
import { getSettings } from './movie-store';
import { recordAppDownload } from './user-data';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi']);

// WebTorrent 2.x is ESM-only. This file compiles to CommonJS, so a plain `import()`
// would be rewritten to `require()`. Hiding it inside Function keeps it a real dynamic import.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;

export interface TorrentStreamInfo {
  infoHash: string;
  fileIndex: number;
  fileName: string;
  fileSize: number;
  streamPath: string; // path on the media server, e.g. /torrent/<hash>/0
}

export interface TorrentStats {
  infoHash: string;
  ready: boolean;
  progress: number; // 0..1 of the whole torrent
  fileProgress: number; // 0..1 of the video file being streamed
  downloadSpeed: number; // bytes/s
  uploadSpeed: number; // bytes/s
  peers: number;
  downloaded: number;
  fileSize: number;
}

let client: any = null;
let active: any = null; // current torrent
let activeFileIndex = 0;
let starting: Promise<TorrentStreamInfo> | null = null;

function downloadRoot(): string {
  return path.join(app.getPath('temp'), 'cinelocal-torrents');
}

async function getClient(): Promise<any> {
  if (client) return client;
  const entry = path.join(__dirname, '..', '..', 'node_modules', 'webtorrent', 'index.js');
  const resolved = fs.existsSync(entry)
    ? entry
    : path.join(__dirname, '..', 'node_modules', 'webtorrent', 'index.js');
  const mod = await dynamicImport(pathToFileURL(resolved).href);
  const WebTorrent = mod.default;
  client = new WebTorrent({ utp: false });
  applyThrottle();
  client.on('error', (err: Error) => console.error('[torrent] client error:', err.message));
  return client;
}

function removeTorrent(torrent: any): Promise<void> {
  return new Promise(resolve => {
    try {
      torrent.destroy({ destroyStore: true }, () => resolve());
    } catch {
      resolve();
    }
  });
}

// ─── Downloads (saved into the movie library) ───────────────────────

export interface DownloadInfo {
  infoHash: string;
  title: string;
  year: number;
  quality: string;
  status: 'queued' | 'metadata' | 'downloading' | 'paused' | 'finalizing' | 'done' | 'error';
  progress: number; // 0..1
  downloadSpeed: number;
  peers: number;
  downloaded: number;
  size: number;
  error?: string;
  savedPath?: string;
  imdbId?: string;
  /** Set for TV episodes (used to fetch a matching subtitle). */
  series?: { showTitle: string; season: number; episode: number };
}

export interface DownloadMeta {
  title: string;
  year: number;
  quality: string;
  /** IMDb id of the movie / show: lets the subtitle lookup be exact. */
  imdbId?: string;
  /** Set for TV episodes: saved as Show/Season NN/Show - SNNENN [quality].ext */
  series?: { showTitle: string; season: number; episode: number };
}

interface DownloadEntry {
  series?: DownloadMeta['series'];
  magnet: string;
  torrent: any | null; // null while queued
  info: DownloadInfo;
  stagingDir: string;
  libraryRoot: string;
  fileIndex: number;
}

const downloads = new Map<string, DownloadEntry>();
let downloadFinished: ((info: DownloadInfo) => void) | null = null;
let activeShared = false; // active stream is borrowed from a download and must not be destroyed

export function setDownloadFinishedHandler(cb: (info: DownloadInfo) => void) {
  downloadFinished = cb;
}

const hashFromMagnet = (magnet: string) => /btih:([0-9a-fA-F]{40})/.exec(magnet)?.[1].toLowerCase() || '';
const safeName = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');

/** Download speed cap (KB/s, 0 = unlimited). It only applies while no title is being streamed. */
function applyThrottle() {
  if (!client) return;
  const kb = parseInt(getSettings('downloadLimitKBps') || '0', 10) || 0;
  const streaming = !!active && !activeShared;
  try { client.throttleDownload(kb > 0 && !streaming ? kb * 1024 : -1); } catch { /* older client */ }
}
export { applyThrottle as applyDownloadLimits };

const maxConcurrent = () => Math.max(1, parseInt(getSettings('maxConcurrentDownloads') || '2', 10) || 2);

/** Starts queued downloads while there are free slots. */
function pumpQueue() {
  const running = Array.from(downloads.values()).filter(e => ['metadata', 'downloading'].includes(e.info.status)).length;
  let free = maxConcurrent() - running;
  for (const e of downloads.values()) {
    if (free <= 0) break;
    if (e.info.status === 'queued') { free--; beginTorrent(e).catch(err => { e.info.status = 'error'; e.info.error = err instanceof Error ? err.message : String(err); }); }
  }
}
setInterval(() => { if (client) { pumpQueue(); applyThrottle(); } }, 3000).unref?.();

export async function startDownload(
  magnet: string,
  meta: DownloadMeta,
  libraryRoot: string
): Promise<DownloadInfo> {
  const hash = hashFromMagnet(magnet);
  if (!hash) throw new Error('Invalid magnet link');
  const existing = downloads.get(hash);
  if (existing && existing.info.status !== 'error') return existing.info;
  if (existing) downloads.delete(hash);

  await getClient();

  const stagingDir = path.join(libraryRoot, '.cinelocal-downloads', hash);
  fs.mkdirSync(stagingDir, { recursive: true });

  const info: DownloadInfo = {
    infoHash: hash, title: meta.title, year: meta.year, quality: meta.quality,
    status: 'queued', progress: 0, downloadSpeed: 0, peers: 0, downloaded: 0, size: 0, series: meta.series, imdbId: meta.imdbId,
  };
  const entry: DownloadEntry = { magnet, torrent: null, info, stagingDir, libraryRoot, fileIndex: 0, series: meta.series };
  downloads.set(hash, entry);
  pumpQueue();
  return info;
}

/** Actually starts a queued download. */
async function beginTorrent(entry: DownloadEntry) {
  const { info, stagingDir } = entry;
  const hash = info.infoHash;
  const wt = await getClient();
  // A stream of the same torrent in the temp folder would clash with the download.
  if (active && active.infoHash === hash && !activeShared) await stopTorrent();
  info.status = 'metadata';
  const torrent = wt.add(entry.magnet, { path: stagingDir });
  entry.torrent = torrent;

  const fail = (message: string) => {
    info.status = 'error';
    info.error = message;
    try { torrent.destroy({ destroyStore: true }); } catch { /* already gone */ }
    fs.rmSync(stagingDir, { recursive: true, force: true });
  };

  const metaTimeout = setTimeout(() => {
    if (info.status === 'metadata') fail('Could not find peers for this torrent. Try another quality.');
  }, 120000);

  torrent.on('error', (err: Error) => { clearTimeout(metaTimeout); fail(err.message); });

  torrent.on('ready', () => {
    clearTimeout(metaTimeout);
    const files: any[] = torrent.files;
    let best = -1;
    files.forEach((f, i) => {
      if (!VIDEO_EXTENSIONS.has(path.extname(f.name).toLowerCase())) return;
      if (best === -1 || f.length > files[best].length) best = i;
    });
    if (best === -1) return fail('No video file found in this torrent.');
    torrent.deselect(0, torrent.pieces.length - 1, 0);
    files.forEach((f, i) => { if (i !== best) f.deselect(); });
    files[best].select();
    entry.fileIndex = best;
    info.size = files[best].length;
    if (info.status === 'metadata') info.status = 'downloading';
  });

  torrent.on('done', () => { finalizeDownload(entry).catch(err => fail(err instanceof Error ? err.message : String(err))); });
}

async function finalizeDownload(entry: DownloadEntry) {
  const torrent = entry.torrent;
  const { info } = entry;
  info.status = 'finalizing';
  const file = torrent.files[entry.fileIndex];
  const source = path.join(entry.stagingDir, file.path);

  // If the user is streaming this torrent right now, wait until they close the player.
  while (active === torrent) await new Promise(r => setTimeout(r, 2000));

  await new Promise<void>(resolve => { try { torrent.destroy({ destroyStore: false }, () => resolve()); } catch { resolve(); } });

  const ext = path.extname(file.name);
  let destDir: string;
  let dest: string;
  if (entry.series) {
    const pad = (n: number) => String(n).padStart(2, '0');
    const show = safeName(entry.series.showTitle);
    destDir = path.join(entry.libraryRoot, show, `Season ${pad(entry.series.season)}`);
    dest = path.join(destDir, `${show} - S${pad(entry.series.season)}E${pad(entry.series.episode)} [${info.quality}]${ext}`);
  } else {
    const base = `${safeName(info.title)} (${info.year})`;
    destDir = path.join(entry.libraryRoot, base);
    dest = path.join(destDir, `${base} [${info.quality}]${ext}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  try {
    fs.renameSync(source, dest);
  } catch {
    fs.copyFileSync(source, dest); // different drive
    fs.unlinkSync(source);
  }
  fs.rmSync(entry.stagingDir, { recursive: true, force: true });
  try { fs.rmdirSync(path.dirname(entry.stagingDir)); } catch { /* other downloads still staging */ }

  info.status = 'done';
  info.progress = 1;
  info.downloadSpeed = 0;
  info.savedPath = dest;
  try { recordAppDownload(dest); } catch { /* not critical */ }
  pumpQueue();
  downloadFinished?.(info);
}

export function getDownloads(): DownloadInfo[] {
  return Array.from(downloads.values()).map(({ torrent, info, fileIndex }) => {
    if (!torrent) return { ...info };
    if (info.status === 'downloading' || info.status === 'paused') {
      const file = torrent.ready ? torrent.files[fileIndex] : null;
      info.progress = file ? file.progress : 0;
      info.downloaded = file ? file.downloaded : 0;
      info.downloadSpeed = info.status === 'paused' ? 0 : torrent.downloadSpeed || 0;
    }
    info.peers = torrent.numPeers || 0;
    return { ...info };
  });
}

export async function cancelDownload(hash: string) {
  const entry = downloads.get(hash);
  if (!entry) return;
  downloads.delete(hash);
  if (entry.info.status === 'done') return;
  if (entry.torrent && active === entry.torrent) { active = null; activeShared = false; }
  if (entry.torrent) await new Promise<void>(resolve => { try { entry.torrent.destroy({ destroyStore: true }, () => resolve()); } catch { resolve(); } });
  fs.rmSync(entry.stagingDir, { recursive: true, force: true });
  pumpQueue();
}

export function pauseDownload(hash: string) {
  const e = downloads.get(hash);
  if (e && e.torrent && e.info.status === 'downloading') { e.torrent.pause(); e.info.status = 'paused'; }
}

export function resumeDownload(hash: string) {
  const e = downloads.get(hash);
  if (e && e.torrent && e.info.status === 'paused') { e.torrent.resume(); e.info.status = 'downloading'; }
}

export function clearFinishedDownloads() {
  for (const [hash, e] of downloads) if (e.info.status === 'done' || e.info.status === 'error') downloads.delete(hash);
}

// ─── Streaming ──────────────────────────────────────────────────────

export async function stopTorrent(): Promise<void> {
  const torrent = active;
  const shared = activeShared;
  active = null;
  activeShared = false;
  if (torrent && !shared) await removeTorrent(torrent);
  applyThrottle();
}

export function startTorrent(magnet: string): Promise<TorrentStreamInfo> {
  // Serialise: ignore overlapping start calls from rapid clicks by chaining.
  const run = async (): Promise<TorrentStreamInfo> => {
    await stopTorrent();
    const wt = await getClient();

    // Already downloading this movie: stream straight from the download.
    const dl = downloads.get(hashFromMagnet(magnet));
    if (dl && dl.torrent && dl.info.status !== 'error' && dl.info.status !== 'done' && dl.info.status !== 'queued') {
      if (!dl.torrent.ready) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('Timed out finding peers for this torrent.')), 45000);
          dl.torrent.once('ready', () => { clearTimeout(t); resolve(); });
        });
      }
      active = dl.torrent;
      activeShared = true;
      activeFileIndex = dl.fileIndex;
      const f = dl.torrent.files[dl.fileIndex];
      return {
        infoHash: dl.torrent.infoHash, fileIndex: dl.fileIndex, fileName: f.name, fileSize: f.length,
        streamPath: `/torrent/${dl.torrent.infoHash}/${dl.fileIndex}`,
      };
    }

    fs.mkdirSync(downloadRoot(), { recursive: true });

    return new Promise<TorrentStreamInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out finding peers for this torrent. Try another quality.'));
        if (active === torrent) stopTorrent();
        else torrent.destroy();
      }, 45000);

      const torrent = wt.add(magnet, { path: downloadRoot() });
      active = torrent;
      applyThrottle();

      torrent.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      torrent.on('ready', () => {
        clearTimeout(timeout);
        const files: any[] = torrent.files;
        let best = -1;
        files.forEach((f, i) => {
          if (!VIDEO_EXTENSIONS.has(path.extname(f.name).toLowerCase())) return;
          if (best === -1 || f.length > files[best].length) best = i;
        });
        if (best === -1) {
          reject(new Error('No playable video file found in this torrent.'));
          return;
        }

        // Only download the video file, not subtitles/artwork/other files.
        torrent.deselect(0, torrent.pieces.length - 1, 0);
        files.forEach((f, i) => { if (i !== best) f.deselect(); });
        files[best].select();
        activeFileIndex = best;

        resolve({
          infoHash: torrent.infoHash,
          fileIndex: best,
          fileName: files[best].name,
          fileSize: files[best].length,
          streamPath: `/torrent/${torrent.infoHash}/${best}`,
        });
      });
    });
  };

  starting = (starting ? starting.catch(() => undefined).then(run) : run());
  return starting;
}

export function getTorrentStats(): TorrentStats | null {
  const t = active;
  if (!t) return null;
  const file = t.ready ? t.files[activeFileIndex] : null;
  return {
    infoHash: t.infoHash,
    ready: !!t.ready,
    progress: t.progress || 0,
    fileProgress: file ? file.progress : 0,
    downloadSpeed: t.downloadSpeed || 0,
    uploadSpeed: t.uploadSpeed || 0,
    peers: t.numPeers || 0,
    downloaded: file ? file.downloaded : 0,
    fileSize: file ? file.length : 0,
  };
}

/** Returns a byte-range stream of the active torrent's video file, or null if it isn't active. */
export function getTorrentFile(infoHash: string, fileIndex: number):
  { name: string; length: number; createReadStream: (range: { start: number; end: number }) => Readable } | null {
  if (!active || !active.ready || active.infoHash !== infoHash) return null;
  const file = active.files[fileIndex];
  return file || null;
}

export async function destroyTorrentClient(): Promise<void> {
  // Quitting cancels unfinished downloads and removes their partial staging files.
  for (const hash of Array.from(downloads.keys())) await cancelDownload(hash);
  await stopTorrent();
  if (client) {
    const c = client;
    client = null;
    await new Promise<void>(resolve => c.destroy(() => resolve()));
  }
  try {
    fs.rmSync(downloadRoot(), { recursive: true, force: true });
  } catch { /* best effort */ }
}
