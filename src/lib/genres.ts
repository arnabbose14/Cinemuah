import type { SeriesShow } from '@/types';

/** Genre shortcuts shown as pills on Home, Movies and Series. Values are YTS genre slugs. */
export const GENRE_PILLS: { label: string; value: string }[] = [
  ['Action', 'action'], ['Adventure', 'adventure'], ['Animation', 'animation'], ['Biography', 'biography'], ['Comedy', 'comedy'],
  ['Crime', 'crime'], ['Documentary', 'documentary'], ['Drama', 'drama'], ['Family', 'family'],
  ['Fantasy', 'fantasy'], ['History', 'history'], ['Horror', 'horror'], ['Music', 'music'], ['Mystery', 'mystery'],
  ['Romance', 'romance'], ['Sci-Fi', 'sci-fi'], ['Sport', 'sport'], ['Thriller', 'thriller'], ['War', 'war'], ['Western', 'western'],
].map(([label, value]) => ({ label, value }));

const canon = (g: string) => {
  const n = g.toLowerCase().replace(/[^a-z]/g, '');
  return n === 'scifi' ? 'sciencefiction' : n;       // TVMaze says "Science-Fiction"
};

/** Does a TV show belong to the genre pill (TVMaze genre names differ slightly from YTS)? */
export const showHasGenre = (show: SeriesShow, genre: string): boolean =>
  genre === 'all' || show.genres.some(g => canon(g) === canon(genre));
