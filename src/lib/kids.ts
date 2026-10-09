// Kids profiles only see family-friendly titles. YTS / TVMaze give genres, so that is what we filter on.
let kids = false;
export const setKidsMode = (v: boolean) => { kids = v; };
export const isKidsMode = () => kids;

const FRIENDLY = ['family', 'animation', 'children', 'kids'];
const NOT_FOR_KIDS = ['horror', 'thriller', 'crime', 'war', 'adult', 'mystery', 'western', 'drama', 'romance', 'sport', 'documentary', 'history', 'biography', 'music'];

/** True when the genres suit a kids profile (always true outside kids mode). */
export function kidsAllowed(genres: string[]): boolean {
  if (!kids) return true;
  const g = genres.map(x => x.toLowerCase());
  return g.some(x => FRIENDLY.includes(x)) && !g.some(x => ['horror', 'thriller', 'crime', 'war', 'adult'].includes(x));
}

/** Genre pills hidden for kids. */
export const kidsHiddenGenre = (value: string): boolean => kids && NOT_FOR_KIDS.includes(value.toLowerCase());
