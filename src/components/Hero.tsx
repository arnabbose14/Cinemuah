import React, { useState, useEffect, useRef } from 'react';
import type { Movie } from '@/types';
import { formatDuration, parseMovieGenres, formatSeconds, getProgressPercent } from '@/types';
import { useMedia } from '@/contexts/MediaContext';
import { Icon } from './Icon';

interface HeroProps {
  movie: Movie | null;
  onPlay: (movie: Movie) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
}

export function Hero({ movie, onPlay, onDetail, onToggleList }: HeroProps) {
  const { getBackdropUrl } = useMedia();
  const [bgError, setBgError] = useState(false);

  useEffect(() => {
    setBgError(false);
  }, [movie?.id]);

  if (!movie) {
    return (
      <div className="hero">
        <div className="hero-backdrop-placeholder" />
        <div className="hero-gradient" />
      </div>
    );
  }

  const genres = parseMovieGenres(movie.genres);
  const backdropUrl = getBackdropUrl(movie.id, movie.backdrop);
  const progressPercent = getProgressPercent(movie.position, movie.duration > 0 ? movie.duration * 60 : undefined);

  return (
    <div className="hero">
      {backdropUrl && !bgError ? (
        <img
          src={backdropUrl}
          alt={movie.title}
          className="hero-backdrop"
          onError={() => setBgError(true)}
        />
      ) : (
        <div className="hero-backdrop-placeholder" />
      )}

      <div className="hero-gradient" />

      <div className="hero-content">
        <div className="hero-badges">
          <span className="hero-badge featured">Featured</span>
        </div>

        <h1 className="hero-title">{movie.title}</h1>

        <div className="hero-meta">
          {movie.year && <span>{movie.year}</span>}
          {movie.year && movie.duration > 0 && <span className="dot" />}
          {movie.duration > 0 && <span>{formatDuration(movie.duration)}</span>}
          {genres.length > 0 && <><span className="dot" /><span>{genres.slice(0, 2).join(' · ')}</span></>}
          {movie.rating > 0 && (
            <>
              <span className="dot" />
              <span className="rating"><Icon name="star" size={14} /> {movie.rating.toFixed(1)}</span>
            </>
          )}
        </div>

        {movie.description && (
          <p className="hero-description">{movie.description}</p>
        )}

        {progressPercent > 0 && progressPercent < 95 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              height: 3,
              background: 'rgba(255,255,255,0.2)',
              borderRadius: 999,
              marginBottom: 6,
              overflow: 'hidden',
              width: 200,
            }}>
              <div style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: 'var(--accent)',
                borderRadius: 999,
              }} />
            </div>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              {movie.position ? formatSeconds(movie.position) : ''} watched
            </span>
          </div>
        )}

        <div className="hero-actions">
          {progressPercent > 0 && progressPercent < 95 ? (
            <button className="btn btn-primary btn-lg" onClick={() => onPlay(movie)}>
              <Icon name="play" /> Resume
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={() => onPlay(movie)}>
              <Icon name="play" /> Play
            </button>
          )}
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => onToggleList(movie)}
          >
            {movie.isInMyList ? <><Icon name="check" /> In My List</> : <><Icon name="plus" /> My List</>}
          </button>
          <button
            className="btn btn-secondary btn-lg"
            onClick={() => onDetail(movie)}
            style={{ padding: '14px 16px' }}
          >
            <Icon name="info" />
          </button>
        </div>
      </div>
    </div>
  );
}
