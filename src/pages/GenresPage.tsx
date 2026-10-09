import React from 'react';
import type { Movie } from '@/types';
import { parseMovieGenres } from '@/types';
import { Icon } from '@/components/Icon';

interface GenresPageProps {
  genres: string[];
  movies: Movie[];
  onSelectGenre: (genre: string) => void;
}

const GENRE_COLORS: Record<string, string> = {
  Action: 'linear-gradient(135deg, #c0392b, #8e44ad)',
  Adventure: 'linear-gradient(135deg, #27ae60, #16a085)',
  Animation: 'linear-gradient(135deg, #f39c12, #e74c3c)',
  Comedy: 'linear-gradient(135deg, #f1c40f, #e67e22)',
  Crime: 'linear-gradient(135deg, #2c3e50, #4a6274)',
  Documentary: 'linear-gradient(135deg, #1abc9c, #3498db)',
  Drama: 'linear-gradient(135deg, #3498db, #1abc9c)',
  Fantasy: 'linear-gradient(135deg, #8e44ad, #3498db)',
  Horror: 'linear-gradient(135deg, #1a1a1a, #c0392b)',
  Music: 'linear-gradient(135deg, #e74c3c, #f39c12)',
  Mystery: 'linear-gradient(135deg, #2c3e50, #8e44ad)',
  Romance: 'linear-gradient(135deg, #e91e63, #9c27b0)',
  'Sci-Fi': 'linear-gradient(135deg, #0099ff, #00d4ff)',
  'Science Fiction': 'linear-gradient(135deg, #0099ff, #00d4ff)',
  Thriller: 'linear-gradient(135deg, #34495e, #c0392b)',
  War: 'linear-gradient(135deg, #7f8c8d, #2c3e50)',
  Western: 'linear-gradient(135deg, #d35400, #8e6020)',
};

function getGenreColor(genre: string): string {
  return GENRE_COLORS[genre] || `linear-gradient(135deg, hsl(${Math.abs(genre.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 50%, 30%), hsl(${(Math.abs(genre.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) + 40) % 360}, 60%, 25%))`;
}

export function GenresPage({ genres, movies, onSelectGenre }: GenresPageProps) {
  // Count movies per genre
  const genreCounts: Record<string, number> = {};
  for (const movie of movies) {
    const g = parseMovieGenres(movie.genres);
    for (const genre of g) {
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    }
  }

  const sortedGenres = genres
    .filter(g => (genreCounts[g] || 0) >= 1)
    .sort((a, b) => (genreCounts[b] || 0) - (genreCounts[a] || 0));

  if (sortedGenres.length === 0) {
    return (
      <div className="genres-page">
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 32 }}>Genres</h1>
        <div className="empty-state">
          <div className="empty-icon"><Icon name="film" /></div>
          <h2 className="empty-title">No genres found</h2>
          <p className="empty-subtitle">Genres will appear here once your movies have metadata.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="genres-page">
      <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 8 }}>Genres</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
        {sortedGenres.length} genres across your library
      </p>

      <div className="genres-grid">
        {sortedGenres.map(genre => (
          <div
            key={genre}
            className="genre-tile"
            onClick={() => onSelectGenre(genre)}
          >
            <div
              className="genre-tile-bg"
              style={{ background: getGenreColor(genre) }}
            />
            <div className="genre-tile-title">
              {genre}
              <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 4 }}>
                {genreCounts[genre] || 0} movie{genreCounts[genre] !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
