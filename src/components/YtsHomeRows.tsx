import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Movie, YtsMovie, YtsTorrent, YtsListOptions } from '@/types';
import { pickDefaultTorrent } from '@/types';
import { YtsCard, YtsDetail, TorrentPlayer, useYtsImage } from '@/pages/DiscoverPage';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from './Icon';
import type { SeriesShow } from '@/types';
import { SeriesCard, SeriesDetail, useSeriesActions } from '@/pages/SeriesPage';
import { matchesLanguageName } from '@/lib/languages';
import { useLanguages } from '@/lib/languages';
import { watchableList } from '@/lib/yts';
import { movieStream, specFromHistory, type StreamSpec } from '@/lib/streams';
import { ContinueWatchingRow } from './ContinueWatchingRow';
import { FollowedShowsRow } from './FollowedShowsRow';
import { FeaturedHero } from './FeaturedHero';
import { GenrePills } from './GenrePills';
import { GENRE_PILLS } from '@/lib/genres';
import { kidsAllowed } from '@/lib/kids';

interface RowConfig {
  title: string;
  options: YtsListOptions;
}
interface RecRow extends RowConfig { genre: string }

const GENRE_SLUG: Record<string, string> = { 'sci-fi': 'sci-fi', 'science fiction': 'sci-fi', 'science-fiction': 'sci-fi' };
const slug = (g: string) => GENRE_SLUG[g.trim().toLowerCase()] || g.trim().toLowerCase();

/** "Because you watched X" and "Recommended for you", built from the profile's streaming history. */
function useRecommendations(): RecRow[] {
  const [rows, setRows] = useState<RecRow[]>([]);
  useEffect(() => {
    const api = window.electronAPI.history;
    if (!api) return;
    let cancelled = false;
    api.all().then(items => {
      if (cancelled || items.length === 0) return;
      const genresOf = (g: string) => g.split(',').map(slug).filter(Boolean);
      const counts = new Map<string, number>();
      items.forEach(i => genresOf(i.genres || '').forEach(g => counts.set(g, (counts.get(g) ?? 0) + (i.completed ? 2 : 1))));
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
      const out: RecRow[] = [];
      const last = items.find(i => i.kind === 'movie' && genresOf(i.genres || '').length > 0) ?? items.find(i => genresOf(i.genres || '').length > 0);
      if (last) {
        const g = genresOf(last.genres)[0];
        out.push({ title: `Because you watched ${last.title}`, genre: g, options: { genre: g, sortBy: 'rating', minimumRating: 6, limit: 24, page: 1 } });
      }
      const g2 = top.find(g => !out.some(o => o.genre === g));
      if (g2) out.push({ title: 'Recommended for you', genre: g2, options: { genre: g2, sortBy: 'download_count', minimumRating: 6, limit: 24, page: 1 } });
      setRows(out);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return rows;
}

// These match the lists the main process prefetches at startup, so the rows fill instantly.
const ROWS: RowConfig[] = [
  { title: 'New Releases', options: { sortBy: 'date_added', limit: 24, page: 1 } },
  { title: 'Most Downloaded', options: { sortBy: 'download_count', limit: 24, page: 1 } },
  { title: 'Top Rated', options: { sortBy: 'rating', minimumRating: 7, limit: 24, page: 1 } },
];

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

// Survives leaving and returning to Home
const rowCache = new Map<string, YtsMovie[]>();

interface YtsHomeRowsProps {
  localMovies: Movie[];
  onSeeAll: () => void;
  onSeeSeries: () => void;
  onGenre: (genre: string) => void;
}

export function YtsHomeRows({ localMovies, onSeeAll, onSeeSeries, onGenre }: YtsHomeRowsProps) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const [selected, setSelected] = useState<YtsMovie | null>(null);
  const [streaming, setStreaming] = useState<StreamSpec | null>(null);

  const { languages, ready: languagesReady } = useLanguages();
  const seriesActions = useSeriesActions();
  const [selectedShow, setSelectedShow] = useState<SeriesShow | null>(null);
  const recs = useRecommendations();
  const owned = useMemo(() => new Set(localMovies.map(m => normTitle(m.title))), [localMovies]);

  const stream = (movie: YtsMovie, torrent: YtsTorrent) => {
    setSelected(null);
    setStreaming(movieStream(movie, torrent));
  };

  const download = async (movie: YtsMovie, torrent: YtsTorrent) => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, {
        title: movie.title, year: movie.year, quality: torrent.quality, imdbId: movie.imdbCode,
      });
      showToast(`Downloading ${movie.title} (${torrent.quality}). It will appear in your library when finished.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Download failed', 'error');
    }
  };

  if (streaming) {
    return (
      <TorrentPlayer
        spec={streaming}
        onClose={() => setStreaming(null)}
        onError={msg => { showToast(msg, 'error'); setStreaming(null); }}
      />
    );
  }

  if (seriesActions.player) return seriesActions.player;

  return (
    <>
      <FeaturedHero
        ytsImage={ytsImage}
        languages={languages}
        languagesReady={languagesReady}
        onPlay={m => { const t = pickDefaultTorrent(m.torrents); if (t) stream(m, t); else setSelected(m); }}
        onInfo={setSelected}
      />
      <div style={{ padding: '0 48px' }}><GenrePills genres={GENRE_PILLS} selected="" onSelect={onGenre} showAll={false} /></div>
      <ContinueWatchingRow
        onResume={item => setStreaming(specFromHistory(item))}
        onOpen={item => {
          const id = Number(item.key.split(':')[1]);
          if (item.kind === 'episode') window.electronAPI.series.get(id).then(d => setSelectedShow(d.show)).catch(() => undefined);
          else window.electronAPI.yts.get(id).then(m => { if (m) setSelected(m); }).catch(() => undefined);
        }}
      />
      <FollowedShowsRow onSelect={setSelectedShow} onPlay={seriesActions.playShow} />
      {recs.map(row => (
        <YtsRow
          key={row.title}
          config={row}
          owned={owned}
          languages={languages}
          languagesReady={languagesReady}
          ytsImage={ytsImage}
          onSeeAll={() => onGenre(row.genre)}
          onSelect={setSelected}
          onStream={m => { const t = pickDefaultTorrent(m.torrents); if (t) stream(m, t); else setSelected(m); }}
          onDownload={m => { const t = pickDefaultTorrent(m.torrents); if (t) download(m, t); else setSelected(m); }}
        />
      ))}
      <SeriesRow
        languages={languages}
        languagesReady={languagesReady}
        ytsImage={ytsImage}
        onSeeAll={onSeeSeries}
        onSelect={setSelectedShow}
        onPlay={seriesActions.playShow}
      />
      {ROWS.map(row => (
        <YtsRow
          key={row.title}
          config={row}
          owned={owned}
          languages={languages}
          languagesReady={languagesReady}
          ytsImage={ytsImage}
          onSeeAll={onSeeAll}
          onSelect={setSelected}
          onStream={m => { const t = pickDefaultTorrent(m.torrents); if (t) stream(m, t); else setSelected(m); }}
          onDownload={m => { const t = pickDefaultTorrent(m.torrents); if (t) download(m, t); else setSelected(m); }}
        />
      ))}
      {selectedShow && (
        <SeriesDetail
          show={selectedShow}
          onClose={() => setSelectedShow(null)}
          onStream={(s, ep, t) => { setSelectedShow(null); seriesActions.stream(s, ep, t); }}
          onDownload={seriesActions.download}
        />
      )}
      {selected && <YtsDetail movie={selected} onClose={() => setSelected(null)} onStream={stream} onDownload={download} />}
    </>
  );
}

interface YtsRowProps {
  config: RowConfig;
  owned: Set<string>;
  languages: string[];
  languagesReady: boolean;
  ytsImage: (url: string) => string;
  onSeeAll: () => void;
  onSelect: (m: YtsMovie) => void;
  onStream: (m: YtsMovie) => void;
  onDownload: (m: YtsMovie) => void;
}

function YtsRow({ config, owned, languages, languagesReady, ytsImage, onSeeAll, onSelect, onStream, onDownload }: YtsRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [movies, setMovies] = useState<YtsMovie[] | null>(rowCache.get(config.title) ?? null);
  const [failed, setFailed] = useState(false);
  const [filling, setFilling] = useState(false);
  const moviesRef = useRef(movies);
  moviesRef.current = movies;
  const nextPage = useRef(2);
  const exhausted = useRef(false);
  const MIN_VISIBLE = 14;

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.yts.list(config.options)
      .then(r => {
        if (cancelled) return;
        rowCache.set(config.title, r.movies);
        nextPage.current = 2;
        exhausted.current = false;
        setMovies(r.movies);
        r.movies.forEach(m => { if (m.poster) new Image().src = ytsImage(m.poster); });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [config, ytsImage]);

  // The source can't filter by language, so when the chosen language leaves this row short,
  // keep loading further pages (three at a time) until it has enough titles.
  const fillingNow = useRef(false);
  useEffect(() => {
    if (!movies || !languagesReady || fillingNow.current || exhausted.current) return;
    const enough = (list: YtsMovie[]) => watchableList(list, languages).filter(m => !owned.has(normTitle(m.title))).length >= MIN_VISIBLE;
    if (enough(movies)) return;
    fillingNow.current = true;
    setFilling(true);
    (async () => {
      let acc = moviesRef.current ?? [];
      for (let round = 0; round < 12 && !enough(acc); round++) {
        const pages = [0, 1, 2].map(i => nextPage.current + i);
        const results = await Promise.all(pages.map(pg => window.electronAPI.yts.list({ ...config.options, page: pg }).catch(() => null)));
        let added = false;
        for (const r of results) {
          if (!r) break;
          nextPage.current++;
          const fresh = r.movies.filter(m => !acc.some(x => x.id === m.id));
          if (fresh.length) { acc = [...acc, ...fresh]; added = true; }
        }
        if (!added) { exhausted.current = true; break; }
        rowCache.set(config.title, acc);
        setMovies(acc);
      }
      fillingNow.current = false;
      setFilling(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languagesReady, languages, !!movies]);

  // Source blocked / offline and nothing cached: just hide the row rather than show an error on Home.
  if (failed && !movies) return null;

  const visible = watchableList(movies ?? [], languages).filter(m => !owned.has(normTitle(m.title)));
  if (movies && languagesReady && visible.length === 0 && !filling) return null;

  const scroll = (dir: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: dir === 'right' ? amount : -amount, behavior: 'smooth' });
  };

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">{config.title}</h2>
        <button className="section-link" onClick={onSeeAll}>
          See all <Icon name="chevronRight" size={16} />
        </button>
      </div>
      <div className="movie-row-wrapper">
        <button className="row-scroll-btn left" onClick={() => scroll('left')} aria-label="Scroll left">
          <Icon name="chevronLeft" size={32} />
        </button>
        <div className="movie-row" ref={rowRef}>
          {movies === null || !languagesReady || (visible.length === 0 && filling)
            ? Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="movie-card" style={{ width: 160, flexShrink: 0 }}>
                  <div className="movie-card-poster yts-skeleton" />
                  <div className="movie-card-info">
                    <div className="yts-skeleton-line" style={{ width: '80%' }} />
                  </div>
                </div>
              ))
            : visible.map(m => (
                <div key={m.id} style={{ width: 160, flexShrink: 0 }}>
                  <YtsCard
                    movie={m}
                    posterUrl={ytsImage(m.poster)}
                    onSelect={onSelect}
                    onStream={onStream}
                    onDownload={onDownload}
                  />
                </div>
              ))}
        </div>
        <button className="row-scroll-btn right" onClick={() => scroll('right')} aria-label="Scroll right">
          <Icon name="chevronRight" size={32} />
        </button>
      </div>
    </div>
  );
}

// Survives leaving and returning to Home
let seriesRowCache: SeriesShow[] | null = null;

function SeriesRow({ languages, languagesReady, ytsImage, onSeeAll, onSelect, onPlay }: {
  onPlay: (s: SeriesShow) => void;
  languages: string[];
  languagesReady: boolean;
  ytsImage: (url: string) => string;
  onSeeAll: () => void;
  onSelect: (s: SeriesShow) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [shows, setShows] = useState<SeriesShow[] | null>(seriesRowCache);
  const [failed, setFailed] = useState(false);
  const [filling, setFilling] = useState(false);
  const showsRef = useRef(shows);
  showsRef.current = shows;
  const nextPage = useRef(2);
  const exhausted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.series.list({ page: 1, limit: 24 })
      .then(r => {
        if (cancelled) return;
        seriesRowCache = r.shows;
        nextPage.current = 2;
        exhausted.current = false;
        setShows(r.shows);
        r.shows.forEach(s => { if (s.poster) new Image().src = ytsImage(s.poster); });
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [ytsImage]);

  const matches = (s: SeriesShow) => matchesLanguageName(s.language, languages) && kidsAllowed(s.genres);

  // Same as the movie rows: keep loading more shows until the chosen language fills the row
  const fillingNow = useRef(false);
  useEffect(() => {
    if (!shows || !languagesReady || fillingNow.current || exhausted.current) return;
    if (shows.filter(matches).length >= 12) return;
    fillingNow.current = true;
    setFilling(true);
    (async () => {
      let acc = showsRef.current ?? [];
      for (let round = 0; round < 12 && acc.filter(matches).length < 12; round++) {
        const pages = [0, 1, 2].map(i => nextPage.current + i);
        const results = await Promise.all(pages.map(pg => window.electronAPI.series.list({ page: pg, limit: 24 }).catch(() => null)));
        let added = false;
        for (const r of results) {
          if (!r) break;
          nextPage.current++;
          const fresh = r.shows.filter(s => !acc.some(x => x.id === s.id));
          if (fresh.length) { acc = [...acc, ...fresh]; added = true; }
        }
        if (!added) { exhausted.current = true; break; }
        seriesRowCache = acc;
        setShows(acc);
      }
      fillingNow.current = false;
      setFilling(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languagesReady, languages, !!shows]);

  if (failed && !shows) return null;
  const visible = (shows ?? []).filter(matches);
  if (shows && languagesReady && visible.length === 0 && !filling) return null;

  const scroll = (dir: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    el.scrollBy({ left: (dir === 'right' ? 1 : -1) * el.clientWidth * 0.75, behavior: 'smooth' });
  };

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">Popular Series</h2>
        <button className="section-link" onClick={onSeeAll}>
          See all <Icon name="chevronRight" size={16} />
        </button>
      </div>
      <div className="movie-row-wrapper">
        <button className="row-scroll-btn left" onClick={() => scroll('left')} aria-label="Scroll left">
          <Icon name="chevronLeft" size={32} />
        </button>
        <div className="movie-row" ref={rowRef}>
          {shows === null || !languagesReady || (visible.length === 0 && filling)
            ? Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="movie-card" style={{ width: 160, flexShrink: 0 }}>
                  <div className="movie-card-poster yts-skeleton" />
                  <div className="movie-card-info"><div className="yts-skeleton-line" style={{ width: '80%' }} /></div>
                </div>
              ))
            : visible.map(s => (
                <div key={s.id} style={{ width: 160, flexShrink: 0 }}>
                  <SeriesCard show={s} posterUrl={ytsImage(s.poster)} onSelect={onSelect} onPlay={onPlay} />
                </div>
              ))}
        </div>
        <button className="row-scroll-btn right" onClick={() => scroll('right')} aria-label="Scroll right">
          <Icon name="chevronRight" size={32} />
        </button>
      </div>
    </div>
  );
}
