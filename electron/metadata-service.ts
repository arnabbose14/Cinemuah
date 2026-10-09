// TMDB Metadata Service
// Design: Provider-agnostic interface. Swap provider by changing implementation.

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export interface MovieSearchResult {
  id: number;
  title: string;
  year?: number;
  poster?: string;
  overview?: string;
  rating?: number;
}

export interface MovieMetadata {
  tmdbId: number;
  title: string;
  year?: number;
  description: string;
  poster: string;
  backdrop: string;
  duration: number;
  rating: number;
  genres: string[];
  cast: string; // JSON string of CastMember[]
  director: string;
  writers: string; // JSON string of string[]
}

export interface CastMember {
  name: string;
  character: string;
  profilePhoto?: string;
}

async function tmdbFetch(endpoint: string, apiKey: string): Promise<unknown> {
  const url = `${TMDB_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${apiKey}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 401) throw new Error('Invalid TMDB API key');
    if (response.status === 404) throw new Error('Not found');
    throw new Error(`TMDB API error: ${response.status}`);
  }
  
  return response.json();
}

export async function searchMovieMetadata(
  title: string,
  year?: number,
  apiKey?: string
): Promise<MovieSearchResult[] | null> {
  if (!apiKey) return null;
  
  try {
    const yearParam = year ? `&year=${year}` : '';
    const data = await tmdbFetch(
      `/search/movie?query=${encodeURIComponent(title)}${yearParam}&include_adult=false&language=en-US`,
      apiKey
    ) as { results: Array<{
      id: number;
      title: string;
      release_date?: string;
      poster_path?: string;
      overview?: string;
      vote_average?: number;
    }> };
    
    if (!data.results || data.results.length === 0) return [];
    
    return data.results.slice(0, 5).map(movie => ({
      id: movie.id,
      title: movie.title,
      year: movie.release_date ? new Date(movie.release_date).getFullYear() : undefined,
      poster: movie.poster_path ? `${TMDB_IMAGE_BASE}/w342${movie.poster_path}` : undefined,
      overview: movie.overview,
      rating: movie.vote_average,
    }));
  } catch (error) {
    console.error('TMDB search error:', error);
    return null;
  }
}

export async function fetchMovieMetadata(
  tmdbId: number,
  apiKey: string
): Promise<MovieMetadata | null> {
  if (!apiKey) return null;
  
  try {
    // Fetch movie details + credits in parallel
    const [details, credits] = await Promise.all([
      tmdbFetch(`/movie/${tmdbId}?language=en-US`, apiKey),
      tmdbFetch(`/movie/${tmdbId}/credits?language=en-US`, apiKey),
    ]) as [
      {
        id: number;
        title: string;
        release_date?: string;
        overview?: string;
        poster_path?: string;
        backdrop_path?: string;
        runtime?: number;
        vote_average?: number;
        genres?: Array<{ name: string }>;
      },
      {
        cast?: Array<{ name: string; character: string; profile_path?: string; order?: number }>;
        crew?: Array<{ name: string; job: string; department: string }>;
      }
    ];
    
    const director = credits.crew?.find(c => c.job === 'Director')?.name || '';
    
    const writers = credits.crew
      ?.filter(c => ['Writer', 'Screenplay', 'Story', 'Author'].includes(c.job))
      .map(c => c.name)
      .slice(0, 5) || [];
    
    const cast: CastMember[] = (credits.cast || [])
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .slice(0, 20)
      .map(member => ({
        name: member.name,
        character: member.character,
        profilePhoto: member.profile_path 
          ? `${TMDB_IMAGE_BASE}/w185${member.profile_path}` 
          : undefined,
      }));
    
    const genres = (details.genres || []).map(g => g.name);
    
    return {
      tmdbId: details.id,
      title: details.title,
      year: details.release_date ? new Date(details.release_date).getFullYear() : undefined,
      description: details.overview || '',
      poster: details.poster_path ? `${TMDB_IMAGE_BASE}/w500${details.poster_path}` : '',
      backdrop: details.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${details.backdrop_path}` : '',
      duration: details.runtime || 0,
      rating: details.vote_average || 0,
      genres,
      cast: JSON.stringify(cast),
      director,
      writers: JSON.stringify(writers),
    };
  } catch (error) {
    console.error('TMDB fetch error:', error);
    return null;
  }
}
