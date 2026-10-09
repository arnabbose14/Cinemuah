import type { YtsMovie } from '@/types';
import { matchesLanguages } from './languages';
import { kidsAllowed } from './kids';

/**
 * Applies the user's viewing rules to a YTS movie:
 *  - torrents with 0 peers are dropped (nothing to stream or download from)
 *  - movies left without any torrent are hidden
 *  - movies outside the selected languages are hidden (empty selection = all languages)
 * Returns the movie with its live torrents, or null if it should not be shown.
 */
export function watchable(movie: YtsMovie, languages: string[]): YtsMovie | null {
  if (!matchesLanguages(movie.language, languages)) return null;
  if (!kidsAllowed(movie.genres)) return null;
  const torrents = movie.torrents.filter(t => t.peers > 0);
  if (torrents.length === 0) return null;
  return torrents.length === movie.torrents.length ? movie : { ...movie, torrents };
}

export function watchableList(movies: YtsMovie[], languages: string[]): YtsMovie[] {
  const out: YtsMovie[] = [];
  for (const m of movies) {
    const w = watchable(m, languages);
    if (w) out.push(w);
  }
  return out;
}
