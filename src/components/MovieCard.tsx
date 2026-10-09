import React, { useState } from 'react';
import type { Movie } from '@/types';
import { formatDuration, parseMovieGenres, getProgressPercent, formatSeconds } from '@/types';
import { useMedia } from '@/contexts/MediaContext';
import { warmProbe } from '@/lib/warm';
import { LazyImage } from './LazyImage';
import { Icon } from './Icon';

interface MovieCardProps {
  movie: Movie;
  onPlay: (movie: Movie) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
  size?: 'sm' | 'md' | 'lg';
  showProgress?: boolean;
  /** Fill the grid cell instead of using a fixed width. */
  fluid?: boolean;
}

export function MovieCard({ movie, onPlay, onDetail, onToggleList, size = 'md', showProgress = true, fluid = false }: MovieCardProps) {
  const { getPosterUrl, getMediaUrl } = useMedia();
  const [isHovered, setIsHovered] = useState(false);

  const genres = parseMovieGenres(movie.genres);
  const duration = movie.duration;
  const progressPercent = showProgress ? getProgressPercent(movie.position, duration > 0 ? duration * 60 : undefined) : 0;
  const posterUrl = getPosterUrl(movie.id, movie.poster);

  const widths = { sm: 130, md: 160, lg: 200 };
  const width = fluid ? '100%' : widths[size];

  const remaining = duration > 0 && movie.position 
    ? formatSeconds((duration * 60) - movie.position) 
    : null;

  return (
    <div
      className="movie-card"
      style={{ width }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onDetail(movie)}
    >
      <div className="movie-card-poster">
        {posterUrl ? (
          <img
            src={posterUrl}
            alt={movie.title}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
              if (placeholder) placeholder.style.display = 'flex';
            }}
          />
        ) : null}
        <div 
          className="movie-card-poster-placeholder" 
          style={{ display: posterUrl ? 'none' : 'flex' }}
        >
          <Icon name="film" size={32} />
          <span className="placeholder-title">{movie.title}</span>
        </div>

        {/* Progress bar */}
        {progressPercent > 0 && progressPercent < 95 && (
          <div className="movie-card-progress">
            <div
              className="movie-card-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}

        {/* Hover overlay */}
        <div className="movie-card-overlay">
          <div className="card-overlay-actions">
            <button
              className="card-action-btn play"
              onMouseEnter={() => warmProbe(getMediaUrl(movie.id))}
              onClick={(e) => { e.stopPropagation(); onPlay(movie); }}
              title="Play"
            >
              <Icon name="play" />
            </button>
            <button
              className="card-action-btn list"
              onClick={(e) => { e.stopPropagation(); onToggleList(movie); }}
              title={movie.isInMyList ? 'Remove from My List' : 'Add to My List'}
            >
              {movie.isInMyList ? <Icon name="check" /> : <Icon name="plus" />}
            </button>
            <button
              className="card-action-btn info"
              onClick={(e) => { e.stopPropagation(); onDetail(movie); }}
              title="More Info"
            >
              <Icon name="info" />
            </button>
          </div>
          <div className="card-overlay-title">{movie.title}</div>
          <div className="card-overlay-meta">
            {movie.year && <span>{movie.year}</span>}
            {movie.year && duration > 0 && <span> · </span>}
            {duration > 0 && <span>{formatDuration(duration)}</span>}
            {progressPercent > 0 && remaining && (
              <div style={{ marginTop: 2, color: '#aaa' }}>{remaining} left</div>
            )}
          </div>
        </div>
      </div>

      {/* Card info below poster */}
      <div className="movie-card-info">
        <div className="movie-card-title">{movie.title}</div>
        <div className="movie-card-meta">
          {movie.year || ''}
          {movie.year && duration > 0 && ' · '}
          {duration > 0 ? formatDuration(duration) : ''}
        </div>
      </div>
    </div>
  );
}
