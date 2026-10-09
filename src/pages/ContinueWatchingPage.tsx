import React from 'react';
import type { Movie } from '@/types';
import { formatDuration, formatSeconds, getProgressPercent } from '@/types';
import { MovieCard } from '@/components/MovieCard';
import { useMedia } from '@/contexts/MediaContext';
import { Icon } from '@/components/Icon';

interface ContinueWatchingPageProps {
  movies: Movie[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
}

export function ContinueWatchingPage({ movies, onPlay, onDetail, onToggleList }: ContinueWatchingPageProps) {
  const { getPosterUrl } = useMedia();

  if (movies.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 32 }}>
          Continue Watching
        </h1>
        <div className="empty-state">
          <div className="empty-icon"><Icon name="play" /></div>
          <h2 className="empty-title">Nothing here yet</h2>
          <p className="empty-subtitle">
            Start watching a movie and it will appear here so you can pick up where you left off.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 8 }}>
        Continue Watching
      </h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 32 }}>
        {movies.length} movie{movies.length !== 1 ? 's' : ''} in progress
      </p>

      {/* Large cards for continue watching */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
        {movies.map(movie => {
          const progressPercent = getProgressPercent(movie.position, movie.duration > 0 ? movie.duration * 60 : undefined);
          const remaining = movie.duration > 0 && movie.position
            ? formatSeconds((movie.duration * 60) - movie.position) + ' remaining'
            : '';
          const posterUrl = getPosterUrl(movie.id, movie.poster);

          return (
            <div
              key={movie.id}
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
                cursor: 'pointer',
                transition: 'transform 200ms, box-shadow 200ms',
              }}
              onClick={() => onPlay(movie, movie.position)}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.02)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-lg)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.transform = 'scale(1)';
                (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
              }}
            >
              {/* Poster */}
              <div style={{ position: 'relative', height: 160, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                {posterUrl && (
                  <img
                    src={posterUrl}
                    alt={movie.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
                  />
                )}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to right, rgba(0,0,0,0.7) 0%, transparent 50%)',
                }} />
                <div style={{
                  position: 'absolute', left: 16, bottom: 16,
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, color: 'white', border: '1px solid rgba(255,255,255,0.3)',
                }}>
                  <Icon name="play" />
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: '12px 16px 16px' }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{movie.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  {movie.year || ''}
                  {movie.year && movie.duration > 0 && ' · '}
                  {movie.duration > 0 && formatDuration(movie.duration)}
                </div>

                {/* Progress bar */}
                <div style={{
                  height: 3, background: 'rgba(255,255,255,0.1)',
                  borderRadius: 999, marginBottom: 6, overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%', width: `${progressPercent}%`,
                    background: 'var(--accent)', borderRadius: 999,
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                  <span>{remaining}</span>
                  <span>{Math.round(progressPercent)}% watched</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
