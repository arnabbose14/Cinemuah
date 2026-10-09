import React, { useState, useMemo } from 'react';
import type { Movie, SortOption, SortOrder } from '@/types';
import { MovieCard } from '@/components/MovieCard';
import { Icon } from '@/components/Icon';
import { GenrePills } from '@/components/GenrePills';

interface MoviesPageProps {
  movies: Movie[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
  genre?: string;
  title?: string;
  /** All genres in the library, shown as shortcut pills. */
  genres?: string[];
  onSelectGenre?: (genre: string | null) => void;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'dateAdded', label: 'Recently Added' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'year', label: 'Release Year' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'lastPlayed', label: 'Recently Watched' },
  { value: 'watchCount', label: 'Most Watched' },
];

export function MoviesPage({ movies, onPlay, onDetail, onToggleList, genre, title, genres = [], onSelectGenre }: MoviesPageProps) {
  const [sortBy, setSortBy] = useState<SortOption>('dateAdded');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const sortedMovies = useMemo(() => {
    return [...movies].sort((a, b) => {
      let va: number | string = a[sortBy as keyof Movie] as number | string || 0;
      let vb: number | string = b[sortBy as keyof Movie] as number | string || 0;

      if (sortBy === 'title') {
        va = a.title.toLowerCase();
        vb = b.title.toLowerCase();
        return sortOrder === 'asc'
          ? va.localeCompare(vb)
          : vb.localeCompare(va);
      }

      const numA = Number(va) || 0;
      const numB = Number(vb) || 0;
      return sortOrder === 'asc' ? numA - numB : numB - numA;
    });
  }, [movies, sortBy, sortOrder]);

  const pageTitle = title || genre || 'All Movies';

  const pills = onSelectGenre && genres.length > 0 ? (
    <GenrePills genres={genres.map(g => ({ label: g, value: g }))} selected={genre || 'all'} onSelect={g => onSelectGenre(g === 'all' ? null : g)} />
  ) : null;

  if (movies.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 0' }}>
      {pills}
      <div className="empty-state" style={{ paddingTop: 100 }}>
        <div className="empty-icon"><Icon name="film" /></div>
        <h2 className="empty-title">No movies found</h2>
        <p className="empty-subtitle">
          {genre ? `No movies in the ${genre} genre yet.` : 'Scan your library to discover movies.'}
        </p>
      </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      {pills}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 4 }}>
            {pageTitle}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {sortedMovies.length} movie{sortedMovies.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Sorting */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            style={{
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              padding: '8px 12px',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
            title="Toggle sort order"
          >
            {sortOrder === 'asc' ? <Icon name="arrowUp" size={16} /> : <Icon name="arrowDown" size={16} />}
          </button>
        </div>
      </div>

      <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
        {sortedMovies.map(movie => (
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
