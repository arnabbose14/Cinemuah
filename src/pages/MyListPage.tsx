import React from 'react';
import type { Movie } from '@/types';
import { MovieCard } from '@/components/MovieCard';
import { Icon } from '@/components/Icon';

interface MyListPageProps {
  movies: Movie[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
}

export function MyListPage({ movies, onPlay, onDetail, onToggleList }: MyListPageProps) {
  if (movies.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 32 }}>
          My List
        </h1>
        <div className="empty-state">
          <div className="empty-icon"><Icon name="plus" /></div>
          <h2 className="empty-title">Your list is empty</h2>
          <p className="empty-subtitle">
            Add movies to your list by clicking the + button on any movie card or detail page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 8 }}>
        My List
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
        {movies.length} movie{movies.length !== 1 ? 's' : ''}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 20,
      }}>
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
    </div>
  );
}
