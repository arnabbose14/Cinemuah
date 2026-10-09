import { useState, useEffect, useMemo, useRef } from 'react';
import type { YtsMovie } from '@/types';
import { pickDefaultTorrent } from '@/types';
import { Icon } from './Icon';
import { watchableList } from '@/lib/yts';

const SLIDES = 6;
const ROTATE_MS = 9000;

// Candidate pool survives leaving and returning to Home
let pool: YtsMovie[] | null = null;

interface Props {
  ytsImage: (url: string) => string;
  languages: string[];
  languagesReady: boolean;
  onPlay: (movie: YtsMovie) => void;
  onInfo: (movie: YtsMovie) => void;
}

/** The Featured banner at the top of the online Home: well-rated, recent films with artwork, rotating. */
export function FeaturedHero({ ytsImage, languages, languagesReady, onPlay, onInfo }: Props) {
  const [candidates, setCandidates] = useState<YtsMovie[] | null>(pool);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [bgFailed, setBgFailed] = useState<Set<number>>(new Set());
  const seed = useRef(Math.random());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      window.electronAPI.yts.list({ sortBy: 'rating', minimumRating: 7, limit: 24, page: 1 }).catch(() => null),
      window.electronAPI.yts.list({ sortBy: 'rating', minimumRating: 7, limit: 24, page: 2 }).catch(() => null),
      window.electronAPI.yts.list({ sortBy: 'date_added', limit: 24, page: 1 }).catch(() => null),
    ]).then(rs => {
      if (cancelled) return;
      const all = rs.flatMap(r => r?.movies ?? []);
      const seen = new Set<number>();
      pool = all.filter(m => !seen.has(m.id) && seen.add(m.id));
      setCandidates(pool);
      pool.slice(0, 12).forEach(m => { if (m.backdrop) new Image().src = ytsImage(m.backdrop); });
    });
    return () => { cancelled = true; };
  }, [ytsImage]);

  // Stable pick for the session: rated, with a backdrop and a synopsis, in the viewer's languages
  const slides = useMemo(() => {
    if (!candidates || !languagesReady) return [];
    const good = watchableList(candidates, languages).filter(m => m.backdrop && m.summary && m.summary.length > 40 && m.rating >= 6.5);
    const shuffled = [...good].sort((a, b) => ((a.id * 9301 + seed.current * 49297) % 233280) - ((b.id * 9301 + seed.current * 49297) % 233280));
    return shuffled.slice(0, SLIDES);
  }, [candidates, languages, languagesReady]);

  useEffect(() => { setIndex(0); }, [slides.length]);

  useEffect(() => {
    if (slides.length < 2 || paused) return;
    const timer = setInterval(() => setIndex(i => (i + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length, paused]);

  if (candidates === null || !languagesReady) return <div className="hero" aria-hidden><div className="hero-backdrop-placeholder" /><div className="hero-gradient" /></div>;
  if (slides.length === 0) return <div style={{ height: 'calc(var(--nav-height) + var(--titlebar-offset, 28px))' }} />;

  const movie = slides[Math.min(index, slides.length - 1)];
  const torrent = pickDefaultTorrent(movie.torrents);

  return (
    <div className="hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} data-testid="featured-hero">
      <div key={movie.id} className="hero-slide">
        {!bgFailed.has(movie.id) ? (
          <img src={ytsImage(movie.backdrop)} alt={movie.title} className="hero-backdrop" onError={() => setBgFailed(s => new Set(s).add(movie.id))} />
        ) : (
          <div className="hero-backdrop-placeholder" />
        )}
        <div className="hero-gradient" />
        <div className="hero-content">
          <div className="hero-badges"><span className="hero-badge featured">Featured</span></div>
          <h1 className="hero-title">{movie.title}</h1>
          <div className="hero-meta">
            <span>{movie.year}</span>
            {movie.runtime > 0 && <><span className="dot" /><span>{Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span></>}
            {movie.genres.length > 0 && <><span className="dot" /><span>{movie.genres.slice(0, 2).join(' \u00b7 ')}</span></>}
            {movie.rating > 0 && <><span className="dot" /><span className="rating"><Icon name="star" size={14} /> {movie.rating.toFixed(1)}</span></>}
          </div>
          <p className="hero-description">{movie.summary}</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => (torrent ? onPlay(movie) : onInfo(movie))}><Icon name="play" /> Play</button>
            <button className="btn btn-secondary btn-lg" onClick={() => onInfo(movie)}><Icon name="info" /> More info</button>
          </div>
        </div>
      </div>

      {slides.length > 1 && (
        <div className="hero-dots" role="tablist" aria-label="Featured titles">
          {slides.map((s, i) => (
            <button key={s.id} role="tab" aria-selected={i === index} aria-label={s.title} className={`hero-dot ${i === index ? 'active' : ''}`} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
