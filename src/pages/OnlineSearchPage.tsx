import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { YtsMovie, YtsTorrent, SeriesShow } from '@/types';
import { pickDefaultTorrent } from '@/types';
import { YtsCard, YtsDetail, TorrentPlayer, useYtsImage } from '@/pages/DiscoverPage';
import { SeriesCard, SeriesDetail, useSeriesActions } from '@/pages/SeriesPage';
import { useToast } from '@/contexts/ToastContext';
import { useLanguages, matchesLanguageName } from '@/lib/languages';
import { watchableList } from '@/lib/yts';
import { Icon } from '@/components/Icon';
import { kidsAllowed } from '@/lib/kids';
import { movieStream, type StreamSpec } from '@/lib/streams';

const PAGE_SIZE = 24;
const cleanError = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback;

const filterSelect: React.CSSProperties = {
  background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)', padding: '7px 10px', fontSize: 13, cursor: 'pointer', fontFamily: 'var(--font-sans)',
};

const sectionTitle: React.CSSProperties = { fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '8px 0 16px' };

/** Online-mode search: one query, results from both YTS movies and TV series. */
export function OnlineSearchPage({ query }: { query: string }) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const { languages, ready: languagesReady } = useLanguages();
  const seriesActions = useSeriesActions();

  const [debounced, setDebounced] = useState(query.trim());
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  // Movies (paged)
  const [movies, setMovies] = useState<YtsMovie[]>([]);
  const [movieTotal, setMovieTotal] = useState(0);
  const [moviePage, setMoviePage] = useState(0);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [moviesError, setMoviesError] = useState<string | null>(null);

  // Series (one page)
  const [shows, setShows] = useState<SeriesShow[]>([]);
  const [showsLoading, setShowsLoading] = useState(false);
  const [showsError, setShowsError] = useState<string | null>(null);

  const [selectedMovie, setSelectedMovie] = useState<YtsMovie | null>(null);
  const [selectedShow, setSelectedShow] = useState<SeriesShow | null>(null);
  const [streaming, setStreaming] = useState<StreamSpec | null>(null);

  const requestId = useRef(0);
  const movieLoadingRef = useRef(false);

  const loadMovies = useCallback(async (page: number, id: number) => {
    movieLoadingRef.current = true;
    setMoviesLoading(true);
    setMoviesError(null);
    try {
      const r = await window.electronAPI.yts.list({ query: debounced, page, limit: PAGE_SIZE });
      if (id !== requestId.current) return;
      setMovies(prev => page === 1 ? r.movies : [...prev, ...r.movies.filter(m => !prev.some(p => p.id === m.id))]);
      setMovieTotal(r.total);
      setMoviePage(page);
    } catch (err) {
      if (id === requestId.current) setMoviesError(cleanError(err, 'Movie search failed'));
    } finally {
      if (id === requestId.current) { movieLoadingRef.current = false; setMoviesLoading(false); }
    }
  }, [debounced]);

  // New query: search both sources at once
  useEffect(() => {
    const id = ++requestId.current;
    setMovies([]); setMovieTotal(0); setMoviePage(0); setMoviesError(null);
    setShows([]); setShowsError(null);
    if (!debounced) { setMoviesLoading(false); setShowsLoading(false); movieLoadingRef.current = false; return; }

    loadMovies(1, id);
    setShowsLoading(true);
    window.electronAPI.series.list({ query: debounced })
      .then(r => { if (id === requestId.current) setShows(r.shows); })
      .catch(err => { if (id === requestId.current) setShowsError(cleanError(err, 'Series search failed')); })
      .finally(() => { if (id === requestId.current) setShowsLoading(false); });
  }, [debounced, loadMovies]);

  // More movie results as the end of the list approaches
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMoreMovies = moviePage > 0 && movies.length < movieTotal;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMoreMovies || moviesError) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !movieLoadingRef.current) loadMovies(moviePage + 1, requestId.current);
    }, { root: el.closest('.main-content'), rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMoreMovies, moviesError, moviePage, loadMovies, moviesLoading]);

  // Filters
  const [kind, setKind] = useState<'all' | 'movies' | 'series'>('all');
  const [sinceYear, setSinceYear] = useState(0);
  const [minRating, setMinRating] = useState(0);
  const [quality, setQuality] = useState('all');
  const filtering = kind !== 'all' || sinceYear > 0 || minRating > 0 || quality !== 'all';

  const visibleMovies = useMemo(
    () => (languagesReady && kind !== 'series'
      ? watchableList(movies, languages).filter(m =>
          (!sinceYear || m.year >= sinceYear) && (!minRating || m.rating >= minRating) &&
          (quality === 'all' || m.torrents.some(tr => tr.quality === quality)))
      : []),
    [movies, languages, languagesReady, kind, sinceYear, minRating, quality]
  );
  const visibleShows = useMemo(
    () => (languagesReady && kind !== 'movies' && quality === 'all'
      ? shows.filter(s => matchesLanguageName(s.language, languages) && kidsAllowed(s.genres) && (!sinceYear || s.year >= sinceYear) && (!minRating || s.rating >= minRating))
      : []),
    [shows, languages, languagesReady, kind, sinceYear, minRating, quality]
  );

  const streamMovie = (movie: YtsMovie, torrent: YtsTorrent) => {
    setSelectedMovie(null);
    setStreaming(movieStream(movie, torrent));
  };
  const downloadMovie = async (movie: YtsMovie, torrent: YtsTorrent) => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, { title: movie.title, year: movie.year, quality: torrent.quality, imdbId: movie.imdbCode });
      showToast(`Downloading ${movie.title} (${torrent.quality}). It will appear in your library when finished.`, 'success');
    } catch (err) {
      showToast(cleanError(err, 'Download failed'), 'error');
    }
  };

  if (seriesActions.player) return seriesActions.player;
  if (streaming) {
    return (
      <TorrentPlayer
        spec={streaming}
        onClose={() => setStreaming(null)}
        onError={msg => { showToast(msg, 'error'); setStreaming(null); }}
      />
    );
  }

  const searching = moviesLoading || showsLoading || !languagesReady;
  const nothing = !!debounced && !searching && visibleMovies.length === 0 && visibleShows.length === 0 && !hasMoreMovies;

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 4 }}>
          {debounced ? `Results for "${debounced}"` : 'Search'}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          {debounced ? 'Movies and series' : 'Type in the search box to find movies and series.'}
        </p>
      </div>

      {debounced && (
        <div className="search-filters">
          <div className="search-filter-group">
            {(['all', 'movies', 'series'] as const).map(k => (
              <button key={k} className={`genre-pill ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'All' : k === 'movies' ? 'Movies' : 'Series'}</button>
            ))}
          </div>
          <select value={sinceYear} onChange={e => setSinceYear(Number(e.target.value))} style={filterSelect} title="Released since">
            <option value={0}>Any year</option>
            {[2020, 2010, 2000, 1990, 1980].map(y => <option key={y} value={y}>{y} or newer</option>)}
          </select>
          <select value={minRating} onChange={e => setMinRating(Number(e.target.value))} style={filterSelect} title="Minimum rating">
            <option value={0}>Any rating</option>
            {[5, 6, 7, 8].map(r => <option key={r} value={r}>{r}+ rating</option>)}
          </select>
          <select value={quality} onChange={e => setQuality(e.target.value)} style={filterSelect} title="Quality (movies)">
            <option value="all">Any quality</option>
            <option value="720p">720p</option><option value="1080p">1080p</option><option value="2160p">4K (2160p)</option>
          </select>
          {filtering && <button className="btn btn-ghost btn-sm" onClick={() => { setKind('all'); setSinceYear(0); setMinRating(0); setQuality('all'); }}>Clear filters</button>}
        </div>
      )}

      {nothing && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">Nothing found</h2>
          <p className="empty-subtitle">Try a different title, or check your language settings.</p>
        </div>
      )}

      {/* Series */}
      {debounced && (visibleShows.length > 0 || showsLoading || showsError) && (
        <>
          <h2 style={sectionTitle}>Series{visibleShows.length > 0 ? ` (${visibleShows.length})` : ''}</h2>
          {showsError && <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{showsError}</p>}
          <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', marginBottom: 32 }}>
            {visibleShows.map(s => (
              <SeriesCard key={s.id} show={s} posterUrl={ytsImage(s.poster)} onSelect={setSelectedShow} onPlay={seriesActions.playShow} />
            ))}
            {showsLoading && Array.from({ length: 6 }, (_, i) => (
              <div key={`ss${i}`} className="movie-card" style={{ width: '100%' }}>
                <div className="movie-card-poster yts-skeleton" />
                <div className="movie-card-info"><div className="yts-skeleton-line" style={{ width: '80%' }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Movies */}
      {debounced && (visibleMovies.length > 0 || moviesLoading || moviesError) && (
        <>
          <h2 style={sectionTitle}>Movies</h2>
          {moviesError && visibleMovies.length === 0 && <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{moviesError}</p>}
          <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {visibleMovies.map(m => (
              <YtsCard
                key={m.id}
                movie={m}
                posterUrl={ytsImage(m.poster)}
                onSelect={setSelectedMovie}
                onStream={mv => { const t = pickDefaultTorrent(mv.torrents); if (t) streamMovie(mv, t); else setSelectedMovie(mv); }}
                onDownload={mv => { const t = pickDefaultTorrent(mv.torrents); if (t) downloadMovie(mv, t); else setSelectedMovie(mv); }}
              />
            ))}
            {moviesLoading && Array.from({ length: visibleMovies.length === 0 ? 6 : 4 }, (_, i) => (
              <div key={`ms${i}`} className="movie-card" style={{ width: '100%' }}>
                <div className="movie-card-poster yts-skeleton" />
                <div className="movie-card-info"><div className="yts-skeleton-line" style={{ width: '80%' }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />

      {selectedMovie && (
        <YtsDetail movie={selectedMovie} onClose={() => setSelectedMovie(null)} onStream={streamMovie} onDownload={downloadMovie} />
      )}
      {selectedShow && (
        <SeriesDetail
          show={selectedShow}
          onClose={() => setSelectedShow(null)}
          onStream={(s, ep, t) => { setSelectedShow(null); seriesActions.stream(s, ep, t); }}
          onDownload={seriesActions.download}
        />
      )}
    </div>
  );
}
