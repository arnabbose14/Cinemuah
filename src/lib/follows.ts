import { useSyncExternalStore } from 'react';
import type { FollowedShow, SeriesShow } from '@/types';

// Shows the active profile follows, shared so the follow button and Home row stay in step
let list: FollowedShow[] = [];
let started = false;
const listeners = new Set<() => void>();

export async function refreshFollows(): Promise<void> {
  const api = window.electronAPI.follows;
  if (!api) return;
  try {
    list = await api.list();
    listeners.forEach(l => l());
  } catch { /* keep the last list */ }
}

function subscribe(cb: () => void) {
  if (!started) { started = true; refreshFollows(); }
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export const useFollows = (): FollowedShow[] => useSyncExternalStore(subscribe, () => list);

export async function toggleFollow(show: SeriesShow, following: boolean): Promise<void> {
  const api = window.electronAPI.follows;
  if (!api) return;
  if (following) await api.unfollow(show.id);
  else await api.follow({ showId: show.id, title: show.title, poster: show.poster, payload: JSON.stringify(show) });
  await refreshFollows();
}
