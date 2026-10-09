import React, { useRef } from 'react';
import type { Movie } from '@/types';
import { MovieCard } from './MovieCard';
import { Icon } from './Icon';

interface MovieRowProps {
  title: string;
  movies: Movie[];
  onPlay: (movie: Movie) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
  onSeeAll?: () => void;
  showProgress?: boolean;
  cardSize?: 'sm' | 'md' | 'lg';
}

export function MovieRow({
  title,
  movies,
  onPlay,
  onDetail,
  onToggleList,
  onSeeAll,
  showProgress = true,
  cardSize = 'md',
}: MovieRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  if (movies.length === 0) return null;

  const scroll = (dir: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' });
  };

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">{title}</h2>
        {onSeeAll && (
          <button className="section-link" onClick={onSeeAll}>
            See all <Icon name="chevronRight" size={16} />
          </button>
        )}
      </div>
      <div className="movie-row-wrapper">
        <button className="row-scroll-btn left" onClick={() => scroll('left')} aria-label="Scroll left"><Icon name="chevronLeft" size={32} /></button>
        <div className="movie-row" ref={rowRef}>
          {movies.map(movie => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onPlay={onPlay}
              onDetail={onDetail}
              onToggleList={onToggleList}
              showProgress={showProgress}
              size={cardSize}
            />
          ))}
        </div>
        <button className="row-scroll-btn right" onClick={() => scroll('right')} aria-label="Scroll right"><Icon name="chevronRight" size={32} /></button>
      </div>
    </div>
  );
}
