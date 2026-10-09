import { Capacitor, registerPlugin } from '@capacitor/core';
import type { DownloadInfo, TorrentStats, TorrentStreamInfo } from '../../src/types';

/** The Kotlin plugin (see android/app/src/main/java/com/cinemuah/app/NativePlugin.kt). */
export interface NativePlugin {
  httpGet(opts: { url: string; timeoutMs?: number; headers?: Record<string, string> }): Promise<{ status: number; body: string }>;
  httpGetBytes(opts: { url: string; timeoutMs?: number; headers?: Record<string, string> }): Promise<{ status: number; base64: string }>;
  getPort(): Promise<{ port: number }>;
  torrentStart(opts: { magnet: string }): Promise<TorrentStreamInfo>;
  torrentStats(): Promise<Partial<TorrentStats> & { active?: boolean }>;
  torrentStop(): Promise<void>;
  downloadStart(opts: {
    magnet: string; title: string; year: number; quality: string;
    series?: { showTitle: string; season: number; episode: number };
  }): Promise<DownloadInfo>;
  downloadsList(): Promise<{ items: DownloadInfo[] }>;
  downloadCancel(opts: { hash: string }): Promise<void>;
  downloadPause(opts: { hash: string }): Promise<void>;
  downloadResume(opts: { hash: string }): Promise<void>;
  downloadsClear(): Promise<void>;
  libraryList(): Promise<{ items: { id: number; path: string; name: string; size: number; modified: number }[] }>;
  libraryDelete(opts: { id: number }): Promise<void>;
  setPlayerMode(opts: { on: boolean }): Promise<void>;
  openExternal(opts: { url: string }): Promise<void>;
  addListener(event: 'downloadFinished', cb: (info: DownloadInfo) => void): Promise<{ remove: () => void }>;
}

export const isNative = Capacitor.isNativePlatform();
export const Native = registerPlugin<NativePlugin>('CinemuahNative');

/** GET through the native HTTP client (no CORS, DNS-over-HTTPS, so ISP-blocked hosts still work). */
export async function httpGet(url: string, timeoutMs = 12000, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  if (isNative) return Native.httpGet({ url, timeoutMs, headers });
  // Plain browser (UI development only)
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
  return { status: res.status, body: await res.text() };
}

/** GET raw bytes (subtitle archives) through the native client. */
export async function httpGetBytes(url: string, timeoutMs = 20000, headers?: Record<string, string>): Promise<{ status: number; bytes: Uint8Array }> {
  if (isNative) {
    const { status, base64 } = await Native.httpGetBytes({ url, timeoutMs, headers });
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { status, bytes };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}

export async function getJson(url: string, timeoutMs = 12000, headers?: Record<string, string>): Promise<any> {
  const { status, body } = await httpGet(url, timeoutMs, headers);
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  return JSON.parse(body);
}

// ─── Small persistent cache (localStorage) ──────────────────────────

export function cacheGet<T>(key: string, maxAgeMs: number): { value: T; fresh: boolean } | null {
  try {
    const raw = localStorage.getItem('cm:cache:' + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    return { value: v as T, fresh: Date.now() - t < maxAgeMs };
  } catch {
    return null;
  }
}

export function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem('cm:cache:' + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    // storage full: drop old list caches and give up quietly
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cm:cache:')) localStorage.removeItem(k);
    }
  }
}
