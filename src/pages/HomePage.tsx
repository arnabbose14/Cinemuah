import React, { useState, useEffect } from 'react';
import type { Movie, AppMode } from '@/types';
import { parseMovieGenres } from '@/types';
import { Hero } from '@/components/Hero';
import { MovieRow } from '@/components/MovieRow';
import { Icon } from '@/components/Icon';
import { YtsHomeRows } from '@/components/YtsHomeRows';
import { GenrePills } from '@/components/GenrePills';

interface HomePageProps {
  mode: AppMode;
  movies: Movie[];
  continueWatching: Movie[];
  recentlyAdded: Movie[];
  genres: string[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
  onNavigateGenre: (genre: string) => void;
  onNavigatePage: (page: string) => void;
  onOnlineGenre: (genre: string) => void;
}

export function HomePage({
  mode,
  movies,
  continueWatching,
  recentlyAdded,
  genres,
  onPlay,
  onDetail,
  onToggleList,
  onNavigateGenre,
  onNavigatePage,
  onOnlineGenre,
}: HomePageProps) {
  const [heroMovie, setHeroMovie] = useState<Movie | null>(null);

  useEffect(() => {
    if (movies.length === 0) return;
    // Select hero: prefer movies with backdrop, recently added/rated
    const withBackdrop = movies.filter(m => m.backdrop);
    const pool = withBackdrop.length > 0 ? withBackdrop : movies;
    // Random from top 10 rated or most recent
    const top = pool.slice(0, Math.min(10, pool.length));
    setHeroMovie(top[Math.floor(Math.random() * top.length)]);
  }, [movies]);

  // Online mode: YTS rows only
  if (mode === 'online') {
    return (
      <div>
        <YtsHomeRows localMovies={[]} onSeeAll={() => onNavigatePage('discover')} onSeeSeries={() => onNavigatePage('series')} onGenre={onOnlineGenre} />
      </div>
    );
  }

  if (movies.length === 0) {
    return (
      <div>
        <div className="empty-state" style={{ paddingTop: 140, paddingBottom: 40 }}>
          <div className="empty-icon"><Icon name="film" /></div>
          <h2 className="empty-title">Your library is empty</h2>
          <p className="empty-subtitle">
            Go to Settings to configure your movie folder, then scan your library to get started.
          </p>
          <button className="btn btn-accent btn-lg" onClick={() => onNavigatePage('settings')}>
            <Icon name="settings" /> Open Settings
          </button>
        </div>
      </div>
    );
  }

  // Build genre rows
  const genreMovies: Record<string, Movie[]> = {};
  for (const genre of genres) {
    const gMovies = movies.filter(m => {
      const g = parseMovieGenres(m.genres);
      return g.includes(genre);
    });
    if (gMovies.length >= 2) {
      genreMovies[genre] = gMovies.slice(0, 20);
    }
  }

  return (
    <div>
      <Hero
        movie={heroMovie}
        onPlay={onPlay}
        onDetail={onDetail}
        onToggleList={onToggleList}
      />

      {genres.length > 0 && (
        <div style={{ padding: '0 48px', marginTop: 8 }}>
          <GenrePills genres={genres.map(g => ({ label: g, value: g }))} selected="" onSelect={onNavigateGenre} showAll={false} />
        </div>
      )}

      {continueWatching.length > 0 && (
        <MovieRow
          title="Continue Watching"
          movies={continueWatching}
          onPlay={m => onPlay(m, m.position)}
          onDetail={onDetail}
          onToggleList={onToggleList}
          onSeeAll={() => onNavigatePage('continue')}
          showProgress={true}
        />
      )}

      <MovieRow
        title="Recently Added"
        movies={recentlyAdded}
        onPlay={onPlay}
        onDetail={onDetail}
        onToggleList={onToggleList}
        onSeeAll={() => onNavigatePage('movies')}
      />

      {/* Genre rows */}
      {genres.slice(0, 6).map(genre => (
        genreMovies[genre] && (
          <MovieRow
            key={genre}
            title={genre}
            movies={genreMovies[genre]}
            onPlay={onPlay}
            onDetail={onDetail}
            onToggleList={onToggleList}
            onSeeAll={() => onNavigateGenre(genre)}
          />
        )
      ))}

      <MovieRow
        title="All Movies"
        movies={movies.slice(0, 20)}
        onPlay={onPlay}
        onDetail={onDetail}
        onToggleList={onToggleList}
        onSeeAll={() => onNavigatePage('movies')}
      />
    </div>
  );
}
