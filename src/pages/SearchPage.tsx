import React from 'react';
import type { Movie } from '@/types';
import { parseMovieGenres } from '@/types';
import { MovieCard } from '@/components/MovieCard';
import { Icon } from '@/components/Icon';

interface SearchPageProps {
  query: string;
  movies: Movie[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
}

export function SearchPage({ query, movies, onPlay, onDetail, onToggleList }: SearchPageProps) {
  if (!query) {
    return (
      <div className="search-page">
        <div className="search-page-header">
          <h1 className="search-page-title">Search</h1>
          <p className="search-page-subtitle">Search across titles, genres, cast, director, and more</p>
        </div>
        <div className="empty-state">
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">Start typing to search</h2>
          <p className="empty-subtitle">
            Try searching for a movie title, actor, director, genre, or year
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="search-page">
      <div className="search-page-header">
        <h1 className="search-page-title">
          {movies.length > 0 ? `Results for "${query}"` : `No results for "${query}"`}
        </h1>
        {movies.length > 0 && (
          <p className="search-page-subtitle">
            {movies.length} movie{movies.length !== 1 ? 's' : ''} found
          </p>
        )}
      </div>

      {movies.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">No movies found</h2>
          <p className="empty-subtitle">
            Try searching for another title, actor, director, or genre.
          </p>
        </div>
      ) : (
        <div className="search-results-grid">
          {movies.map(movie => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onPlay={onPlay}
              onDetail={onDetail}
              onToggleList={onToggleList}
            />
          ))}
        </div>
      )}
    </div>
  );
}
