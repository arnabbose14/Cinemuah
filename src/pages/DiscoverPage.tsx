import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { YtsMovie, YtsTorrent, TorrentStats } from '@/types';
import { formatBytes, pickDefaultTorrent } from '@/types';
import { VideoPlayer } from '@/components/VideoPlayer';
import { useMedia } from '@/contexts/MediaContext';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from '@/components/Icon';
import { useLanguages } from '@/lib/languages';
import { watchable, watchableList } from '@/lib/yts';
import { movieStream, findNextEpisode, type StreamSpec, type NextEpisode } from '@/lib/streams';
import { GenrePills } from '@/components/GenrePills';
import { GENRE_PILLS } from '@/lib/genres';
import { SaveToPlaylist } from '@/components/SaveToPlaylist';
import { useWatched } from '@/lib/watched';

const SORTS = [
  { value: 'date_added', label: 'Newest Added' },
  { value: 'year', label: 'Release Year' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'download_count', label: 'Most Downloaded' },
  { value: 'like_count', label: 'Most Liked' },
  { value: 'seeds', label: 'Most Seeded' },
  { value: 'title', label: 'Title' },
];

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

const PAGE_SIZE = 50; // the most the API returns per page: fewer round trips

/** Routes YTS artwork through the local media server (works around ISP DNS blocking). */
export function useYtsImage() {
  const { mediaPort } = useMedia();
  return useCallback(
    (url: string) => (url && mediaPort ? `http://127.0.0.1:${mediaPort}/yts-image?u=${encodeURIComponent(url)}` : ''),
    [mediaPort]
  );
}

// Survives navigating away from the page, so coming back shows the feed instantly.
interface FeedState { movies: YtsMovie[]; total: number; page: number }
const feedCache = new Map<string, FeedState>();

export function DiscoverPage({ genre: genreProp = 'all', onGenreChange }: { genre?: string; onGenreChange?: (g: string) => void } = {}) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const debouncedQuery = ''; // searching is global (navbar), this page only browses
  const [localGenre, setLocalGenre] = useState('all');
  const genre = onGenreChange ? genreProp : localGenre;
  const setGenre = onGenreChange ?? setLocalGenre;
  const [quality, setQuality] = useState('all');
  const [sortBy, setSortBy] = useState('date_added');

  const feedKey = JSON.stringify([debouncedQuery.toLowerCase(), genre, quality, sortBy]);
  const initial = feedCache.get(feedKey);
  const [ytsMovies, setYtsMovies] = useState<YtsMovie[]>(initial?.movies ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [page, setPage] = useState(initial?.page ?? 0);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<YtsMovie | null>(null);
  const [streaming, setStreaming] = useState<{ movie: YtsMovie; torrent: YtsTorrent } | null>(null);

  const [mirror, setMirror] = useState('');
  useEffect(() => {
    window.electronAPI.settings.get('ytsMirror').then(v => setMirror(v || '')).catch(() => undefined);
  }, []);

  // Guards against out-of-order responses when filters change quickly
  const requestId = useRef(0);
  const loadingRef = useRef(false);

  const languagesRef = useRef<string[]>([]);

  const fetchPage = useCallback((pageToLoad: number) => window.electronAPI.yts.list({
    query: debouncedQuery, genre, quality, sortBy, page: pageToLoad, limit: PAGE_SIZE,
  }), [debouncedQuery, genre, quality, sortBy]);

  /** Loads `count` consecutive pages in parallel and merges them (in order) into the feed. */
  const loadBatch = useCallback(async (startPage: number, count: number): Promise<YtsMovie[] | null> => {
    const id = ++requestId.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(Array.from({ length: count }, (_, i) =>
        fetchPage(startPage + i).catch(err => (i === 0 ? Promise.reject(err) : null))));
      if (id !== requestId.current) return null;
      const merged = startPage === 1 ? [] : [...(feedCache.get(feedKey)?.movies ?? [])];
      const seen = new Set(merged.map(m => m.id));
      const fresh: YtsMovie[] = [];
      let total = feedCache.get(feedKey)?.total ?? 0;
      let last = startPage - 1;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r) break; // keep pages contiguous: a failed page is retried next time
        total = r.total;
        last = startPage + i;
        for (const m of r.movies) if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); fresh.push(m); }
      }
      feedCache.set(feedKey, { movies: merged, total, page: last });
      setYtsMovies(merged);
      setTotal(total);
      setPage(last);
      // Only warm posters of titles that pass the language filter: the rest will never be shown
      fresh.forEach(m => { if (m.poster && watchable(m, languagesRef.current)) new Image().src = ytsImage(m.poster); });
      return fresh;
    } catch (err) {
      if (id !== requestId.current) return null;
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Failed to load movies');
      return null;
    } finally {
      if (id === requestId.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [fetchPage, feedKey, ytsImage]);

  const loadPage = useCallback((pageToLoad: number, _append: boolean) => loadBatch(pageToLoad, pageToLoad === 1 ? 2 : 1), [loadBatch]);

  // Filters changed: show cached feed immediately, or load the first pages
  useEffect(() => {
    const cached = feedCache.get(feedKey);
    if (cached) {
      setYtsMovies(cached.movies); setTotal(cached.total); setPage(cached.page);
      setLoading(false); setError(null);
      loadingRef.current = false;
    } else {
      setYtsMovies([]); setTotal(0); setPage(0);
      loadPage(1, false);
    }
  }, [feedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Language preference (Settings). YTS has no language filter, so results are filtered here.
  const { languages, ready: languagesReady } = useLanguages();
  languagesRef.current = languages;
  const visibleMovies = useMemo(
    () => (languagesReady ? watchableList(ytsMovies, languages) : []),
    [ytsMovies, languages, languagesReady]
  );

  // Keep fetching (several pages at once) until enough movies in the chosen languages turn up.
  // It never gives up while the catalogue has more pages; a language/filter change cancels it.
  const fillGeneration = useRef(0);
  useEffect(() => { fillGeneration.current++; }, [feedKey, languages]);
  const fillingRef = useRef(false);
  const fillFeed = useCallback(async () => {
    if (fillingRef.current) return;
    fillingRef.current = true;
    const generation = fillGeneration.current;
    try {
      let gained = 0;
      while (gained < 12 && generation === fillGeneration.current) {
        const cur = feedCache.get(feedKey);
        if (!cur || cur.movies.length >= cur.total) break;
        const fetched = await loadBatch(cur.page + 1, 3);
        if (!fetched) break;
        gained += fetched.filter(m => watchable(m, languages)).length;
      }
    } finally {
      fillingRef.current = false;
      // a language change mid-fill: let the observer start a fresh fill for the new language
      if (generation !== fillGeneration.current) loadingRef.current = false;
    }
  }, [feedKey, languages, loadBatch]);

  // Infinite scroll: load the next pages as soon as the end of the feed approaches.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = page > 0 && ytsMovies.length < total;
  const [fillTick, setFillTick] = useState(0);
  useEffect(() => { setFillTick(n => n + 1); }, [languages, feedKey]);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || error || !languagesReady) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingRef.current) fillFeed();
    }, { root: el.closest('.main-content'), rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
    // re-observe after every page so a still-visible sentinel keeps pulling pages
  }, [hasMore, error, languagesReady, page, fillFeed, loading, fillTick]);

  // Safety net: if the observer missed a beat (e.g. the language changed while a fill was running),
  // keep pulling pages while the end of the feed is still near the screen.
  useEffect(() => {
    if (!hasMore || error || !languagesReady) return;
    const timer = setInterval(() => {
      const el = sentinelRef.current;
      if (!el || loadingRef.current || fillingRef.current) return;
      if (el.getBoundingClientRect().top < window.innerHeight + 1500) fillFeed();
    }, 800);
    return () => clearInterval(timer);
  }, [hasMore, error, languagesReady, fillFeed]);

  const handleStream = (movie: YtsMovie, torrent: YtsTorrent) => {
    setSelected(null);
    setStreaming({ movie, torrent });
  };

  const handleDownload = async (movie: YtsMovie, torrent: YtsTorrent) => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, {
        title: movie.title, year: movie.year, quality: torrent.quality, imdbId: movie.imdbCode,
      });
      showToast(`Downloading ${movie.title} (${torrent.quality}). It will appear in your library when finished.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Download failed', 'error');
    }
  };

  // Card shortcuts use the default pick: 1080p with the most peers.
  const streamDefault = (movie: YtsMovie) => {
    const t = pickDefaultTorrent(movie.torrents);
    if (t) handleStream(movie, t); else setSelected(movie);
  };
  const downloadDefault = (movie: YtsMovie) => {
    const t = pickDefaultTorrent(movie.torrents);
    if (t) handleDownload(movie, t); else setSelected(movie);
  };

  if (streaming) {
    return (
      <TorrentPlayer
        spec={movieStream(streaming.movie, streaming.torrent)}
        onClose={() => setStreaming(null)}
        onError={(msg) => { showToast(msg, 'error'); setStreaming(null); }}
      />
    );
  }

  const showEmptyError = !!error && ytsMovies.length === 0;

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 4 }}>Movies</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Stream or download{total > 0 && languages.length === 0 ? ` · ${total.toLocaleString()} streamable movies` : ''}
        </p>
      </div>

      <GenrePills genres={GENRE_PILLS} selected={genre} onSelect={setGenre} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 32 }}>
        <select value={quality} onChange={e => setQuality(e.target.value)} style={selectStyle}>
          <option value="all">All qualities</option>
          <option value="720p">720p</option>
          <option value="1080p">1080p</option>
          <option value="2160p">2160p (4K)</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selectStyle}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {showEmptyError && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="warning" /></div>
          <h2 className="empty-title">Couldn't load movies</h2>
          <p className="empty-subtitle">{error}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Custom mirror URL, e.g. https://mirror.example"
              value={mirror}
              onChange={e => setMirror(e.target.value)}
              style={{ ...selectStyle, minWidth: 320, cursor: 'text' }}
            />
            <button
              className="btn btn-accent"
              onClick={async () => {
                await window.electronAPI.settings.set('ytsMirror', mirror.trim());
                loadPage(1, false);
              }}
            >
              Save &amp; Retry
            </button>
          </div>
        </div>
      )}

      {!error && visibleMovies.length === 0 && !loading && !hasMore && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">No results</h2>
          <p className="empty-subtitle">Try a different search or filter.</p>
        </div>
      )}

      <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {visibleMovies.map(movie => (
          <YtsCard
            key={movie.id}
            movie={movie}
            posterUrl={ytsImage(movie.poster)}
            onSelect={setSelected}
            onStream={streamDefault}
            onDownload={downloadDefault}
          />
        ))}

        {/* Skeleton tiles while a page is loading, so the grid never looks empty */}
        {(loading || !languagesReady) && Array.from({ length: visibleMovies.length === 0 ? 12 : 6 }, (_, i) => (
          <div key={`s${i}`} className="movie-card" style={{ width: '100%' }}>
            <div className="movie-card-poster yts-skeleton" />
            <div className="movie-card-info">
              <div className="yts-skeleton-line" style={{ width: '80%' }} />
              <div className="yts-skeleton-line" style={{ width: '40%', marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>

      {error && ytsMovies.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          Couldn't load more.{' '}
          <button className="btn btn-ghost btn-sm" onClick={() => loadPage(page + 1, true)}>Retry</button>
        </div>
      )}

      {/* Sentinel: when this nears the viewport the next page is fetched automatically */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {hasMore && !error && visibleMovies.length < 12 && (
        <div style={{ textAlign: 'center', marginTop: 24, color: 'var(--text-muted)', fontSize: 13 }}>
          Looking for more titles in your languages...
        </div>
      )}

      {selected && (
        <YtsDetail movie={selected} onClose={() => setSelected(null)} onStream={handleStream} onDownload={handleDownload} />
      )}
    </div>
  );
}

// ─── Grid card ──────────────────────────────────────────────────────

export function YtsCard({ movie: m, posterUrl, onSelect, onStream, onDownload }: {
  movie: YtsMovie;
  posterUrl: string;
  onSelect: (m: YtsMovie) => void;
  onStream: (m: YtsMovie) => void;
  onDownload: (m: YtsMovie) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const watched = useWatched().has(`yts:${m.id}`);
  const qualities = Array.from(new Set(m.torrents.map(t => t.quality))).join(' / ');
  return (
    <div className="movie-card" style={{ width: '100%' }} onClick={() => onSelect(m)}>
      <div className="movie-card-poster">
        {/* Title shows immediately; the poster fades in over it when it arrives */}
        <div className="movie-card-poster-placeholder" style={{ display: 'flex' }}>
          <span className="placeholder-title">{m.title}</span>
        </div>
        {posterUrl && (
          <img
            src={posterUrl}
            alt={m.title}
            decoding="async"
            onLoad={() => setLoaded(true)}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              opacity: loaded ? 1 : 0, transition: 'opacity 250ms ease',
            }}
          />
        )}
        {watched && <span className="watched-badge"><Icon name="check" size={12} /> Watched</span>}
        <div className="movie-card-overlay">
          <div className="card-overlay-actions">
            <button
              className="card-action-btn play"
              title="Stream (1080p, most peers)"
              onClick={e => { e.stopPropagation(); onStream(m); }}
            ><Icon name="play" /></button>
            <button
              className="card-action-btn list"
              title="Download to library"
              onClick={e => { e.stopPropagation(); onDownload(m); }}
            ><Icon name="download" /></button>
            <button
              className="card-action-btn info"
              title="Details and other qualities"
              onClick={e => { e.stopPropagation(); onSelect(m); }}
            ><Icon name="info" /></button>
          </div>
          <div className="card-overlay-title">{m.title}</div>
          <div className="card-overlay-meta">
            <span>{m.year}</span>
            <span> · <Icon name="star" size={12} /> {m.rating.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div className="movie-card-info">
        <div className="movie-card-title">{m.title}</div>
        <div className="movie-card-meta">{m.year} · {qualities}</div>
      </div>
    </div>
  );
}

// ─── Detail modal ───────────────────────────────────────────────────

export function YtsDetail({ movie, onClose, onStream, onDownload }: {
  movie: YtsMovie;
  onClose: () => void;
  onStream: (movie: YtsMovie, torrent: YtsTorrent) => void;
  onDownload: (movie: YtsMovie, torrent: YtsTorrent) => void;
}) {
  const ytsImage = useYtsImage();
  const { mediaPort } = useMedia();
  const [trailerOpen, setTrailerOpen] = useState(false);
  // Default: 1080p with the most peers
  const initial = pickDefaultTorrent(movie.torrents);
  const [hash, setHash] = useState(initial?.hash || '');
  const torrent = movie.torrents.find(t => t.hash === hash);

  return (
    <div className="movie-detail-overlay" onClick={onClose}>
      {trailerOpen && (mediaPort || window.electronAPI.trailerUrl) && (
        <div className="trailer-overlay" onClick={e => { e.stopPropagation(); setTrailerOpen(false); }}>
          <button className="detail-close" onClick={() => setTrailerOpen(false)} title="Close trailer"><Icon name="close" /></button>
          <iframe
            className="trailer-frame"
            title={`${movie.title} trailer`}
            src={window.electronAPI.trailerUrl ? window.electronAPI.trailerUrl(movie.trailerCode) : `http://127.0.0.1:${mediaPort}/trailer?v=${encodeURIComponent(movie.trailerCode)}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
      <div className="movie-detail" onClick={e => e.stopPropagation()}>
        <div className="detail-backdrop">
          {movie.backdrop ? <img src={ytsImage(movie.backdrop)} alt="" /> : <div className="detail-backdrop-placeholder" />}
          <div className="detail-backdrop-gradient" />
          <button className="detail-close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="detail-content">
          <h1 className="detail-title">{movie.title}</h1>
          <div className="detail-meta">
            <span>{movie.year}</span>
            {movie.runtime > 0 && <span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span>}
            <span><Icon name="star" size={14} /> {movie.rating.toFixed(1)}</span>
            {movie.genres.length > 0 && <span>{movie.genres.join(' · ')}</span>}
          </div>

          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
            {movie.summary || 'No synopsis available.'}
          </p>

          {movie.torrents.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>No torrents available for this movie.</p>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {movie.torrents.map(t => (
                  <label
                    key={t.hash}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      background: t.hash === hash ? 'var(--accent-dim)' : 'var(--bg-tertiary)',
                      border: `1px solid ${t.hash === hash ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 14,
                    }}
                  >
                    <input type="radio" name="torrent" checked={t.hash === hash} onChange={() => setHash(t.hash)} />
                    <strong style={{ minWidth: 56 }}>{t.quality}</strong>
                    <span style={{ color: 'var(--text-muted)', minWidth: 70 }}>{t.type}</span>
                    <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>{t.videoCodec}</span>
                    <span style={{ minWidth: 70 }}>{t.size}</span>
                    <span style={{ color: t.seeds > 0 ? '#46d369' : '#e50914', marginLeft: 'auto' }}>
                      {t.seeds} seeds · {t.peers} peers
                    </span>
                  </label>
                ))}
              </div>

              {torrent && /^(x265|hevc)/i.test(torrent.videoCodec) && (
                <p style={{ color: '#f5a623', fontSize: 13, marginBottom: 16 }}>
                  <Icon name="warning" size={14} /> This is an HEVC/x265 encode. It will be converted on the fly for playback (GPU accelerated), so an x264 version starts faster.
                </p>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="btn btn-primary btn-lg"
                  disabled={!torrent}
                  onClick={() => torrent && onStream(movie, torrent)}
                >
                  <Icon name="play" /> Stream{torrent ? ` ${torrent.quality}` : ''}
                </button>
                <button
                  className="btn btn-secondary btn-lg"
                  disabled={!torrent}
                  onClick={() => torrent && onDownload(movie, torrent)}
                >
                  <Icon name="download" /> Download
                </button>
                <SaveToPlaylist large item={{ key: `yts:${movie.id}`, kind: 'yts', title: movie.title, year: movie.year, poster: movie.poster, payload: JSON.stringify(movie) }} />
                {movie.trailerCode && (
                  <button
                    className="btn btn-secondary btn-lg"
                    onClick={() => (mediaPort || window.electronAPI.trailerUrl ? setTrailerOpen(true) : window.electronAPI.shell.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(movie.trailerCode)}`))}
                  >
                    Trailer
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Streaming player ───────────────────────────────────────────────

/** Streams any magnet link through the local media server and plays it. */
export function TorrentPlayer({ spec: initial, onClose, onError }: {
  spec: StreamSpec;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { mediaPort } = useMedia();
  const [spec, setSpec] = useState<StreamSpec>(initial);
  const [notice, setNotice] = useState<string | null>(null);
  const [next, setNext] = useState<NextEpisode | null>(null);
  const spare = useRef<StreamSpec[]>(initial.alternatives ?? []); // sources still to try if this one fails
  const startedAt = useRef(Date.now());
  const lastSaved = useRef(0);
  const { title, magnet } = spec;

  // Remember where the viewer got to so the title shows up under Continue Watching.
  const saveProgress = useCallback((position: number, duration: number) => {
    const api = window.electronAPI.history;
    if (!api || !spec.history || !(duration > 0) || !(position >= 0)) return;
    const now = Date.now();
    if (now - lastSaved.current < 4000 && position / duration < 0.9) return; // never throttle the final save near the end
    lastSaved.current = now;
    api.save({ ...spec.history, position, duration }).catch(() => undefined);
    window.dispatchEvent(new Event('cinemuah:history'));
  }, [spec]);

  const [streamPath, setStreamPath] = useState<string | null>(null);
  const [stats, setStats] = useState<TorrentStats | null>(null);

  /** Moves on to the next source for the same title; false when there is none left. */
  const tryAnotherSource = useCallback((reason: string, resumeAt: number): boolean => {
    const alt = spare.current.shift();
    if (!alt) return false;
    setNotice(`${reason} Trying another source (${alt.history?.quality || 'another quality'})...`);
    startedAt.current = Date.now();
    setSpec({ ...alt, startPosition: resumeAt, alternatives: undefined, episode: alt.episode ?? spec.episode });
    return true;
  }, [spec.episode]);

  // Start the torrent; stop it when the player closes or the source changes.
  useEffect(() => {
    let cancelled = false;
    setStreamPath(null);
    setStats(null);
    startedAt.current = Date.now();
    window.electronAPI.torrent.start(magnet)
      .then(info => { if (!cancelled) setStreamPath(info.streamPath); })
      .catch(err => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Failed to start stream';
        if (!tryAnotherSource("That source didn't respond.", spec.startPosition ?? 0)) onError(msg);
      });
    return () => {
      cancelled = true;
      window.electronAPI.torrent.stop().catch(() => undefined);
    };
  }, [magnet]);

  useEffect(() => {
    const timer = setInterval(() => {
      window.electronAPI.torrent.stats().then(setStats).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Watchdog: connected but nothing arriving for 25s -> give the next source a go
  useEffect(() => {
    if (streamPath && stats && stats.fileProgress === 0 && stats.downloadSpeed === 0 && Date.now() - startedAt.current > 25000) {
      tryAnotherSource('No data is arriving from this source.', spec.startPosition ?? 0);
    }
  }, [stats, streamPath, tryAnotherSource, spec.startPosition]);

  // Work out the next episode in the background so the Up next card is ready
  useEffect(() => {
    setNext(null);
    if (spec.history?.kind !== 'episode') return;
    let cancelled = false;
    findNextEpisode(spec).then(n => { if (!cancelled) setNext(n); });
    return () => { cancelled = true; };
  }, [spec.history?.key]);

  const statusText = !streamPath
    ? stats && stats.peers > 0 ? `Connected to ${stats.peers} peers, getting the first pieces...` : 'Finding peers...'
    : stats
      ? `Buffering · ${formatBytes(stats.downloadSpeed)}/s · ${stats.peers} peers · ${(stats.fileProgress * 100).toFixed(1)}% downloaded`
      : 'Buffering...';

  const src = streamPath && mediaPort ? `http://127.0.0.1:${mediaPort}${streamPath}` : null;

  if (!src) {
    return (
      <div className="player-overlay">
        <div className="player-container cursor-visible" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'white' }}>
          <button className="icon-btn" style={{ position: 'absolute', top: 24, left: 24, color: 'white' }} onClick={onClose} title="Cancel"><Icon name="back" size={24} /></button>
          <div className="spinner" />
          <p style={{ fontSize: 14, color: '#ccc' }}>{title}</p>
          <p style={{ fontSize: 13, color: '#888' }}>{statusText}</p>
          {notice && <p style={{ fontSize: 13, color: '#f5a623' }}>{notice}</p>}
        </div>
      </div>
    );
  }

  return (
    <VideoPlayer
      src={src}
      title={title}
      statusText={statusText}
      startPosition={spec.startPosition}
      subtitleContext={spec.subtitleContext}
      episodeMode={spec.history?.kind === 'episode'}
      nextUp={next ? { label: next.label, onPlay: () => { lastSaved.current = 0; spare.current = next.spec.alternatives ?? []; setNotice(null); setSpec({ ...next.spec, startPosition: 0 }); setNext(null); } } : undefined}
      onClose={onClose}
      onProgressUpdate={saveProgress}
    />
  );
}
