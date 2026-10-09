import { useSyncExternalStore } from 'react';

// What this profile has watched to the end, shared by every card so they can show a "Watched" mark
let keys = new Set<string>();
let started = false;
const listeners = new Set<() => void>();

export async function refreshWatched(): Promise<void> {
  const api = window.electronAPI.history;
  if (!api) return;
  try {
    keys = new Set(await api.watched());
    listeners.forEach(l => l());
  } catch { /* keep the last known set */ }
}

function subscribe(cb: () => void) {
  if (!started) {
    started = true;
    window.addEventListener('cinemuah:history', () => { refreshWatched(); });
    refreshWatched();
  }
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Keys such as "yts:12" or "ep:345:1x2" of everything watched to the end. */
export const useWatched = (): Set<string> => useSyncExternalStore(subscribe, () => keys);
