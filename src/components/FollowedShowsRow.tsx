import { useState, useEffect, useRef, useMemo } from 'react';
import type { SeriesShow, SeriesEpisode } from '@/types';
import { Icon } from './Icon';
import { SeriesCard } from '@/pages/SeriesPage';
import { useYtsImage } from '@/pages/DiscoverPage';
import { useFollows } from '@/lib/follows';
import { useWatched } from '@/lib/watched';

const pad = (n: number) => String(n).padStart(2, '0');
const NEW_DAYS = 14;

interface Status { newest: SeriesEpisode | null; unwatched: SeriesEpisode | null; isNew: boolean }

// Episode lists are fetched once per session per show
const episodeCache = new Map<number, SeriesEpisode[]>();

/** "Your Shows": followed series, with a New episode badge when something aired recently that you haven't watched. */
export function FollowedShowsRow({ onSelect, onPlay }: { onSelect: (show: SeriesShow) => void; onPlay?: (show: SeriesShow) => void }) {
  const follows = useFollows();
  const watched = useWatched();
  const ytsImage = useYtsImage();
  const rowRef = useRef<HTMLDivElement>(null);
  const [, bump] = useState(0);

  const shows = useMemo(() => follows.flatMap(f => { try { return [JSON.parse(f.payload) as SeriesShow]; } catch { return []; } }), [follows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const s of shows) {
        if (cancelled || episodeCache.has(s.id)) continue;
        try {
          const d = await window.electronAPI.series.get(s.id);
          episodeCache.set(s.id, d.episodes);
          if (!cancelled) bump(n => n + 1);
        } catch { /* try again next visit */ }
      }
    })();
    return () => { cancelled = true; };
  }, [shows]);

  const statusOf = (s: SeriesShow): Status => {
    const eps = episodeCache.get(s.id);
    if (!eps) return { newest: null, unwatched: null, isNew: false };
    const today = new Date().toISOString().slice(0, 10);
    const aired = eps.filter(e => e.airdate && e.airdate <= today && e.torrents.length > 0).sort((a, b) => a.season - b.season || a.number - b.number);
    const key = (e: SeriesEpisode) => `ep:${s.id}:${e.season}x${e.number}`;
    // "Next" is the first unwatched episode after the furthest one you have watched (or the first episode)
    let furthest = -1;
    aired.forEach((e, i) => { if (watched.has(key(e))) furthest = i; });
    const unwatched = aired.slice(furthest + 1).find(e => !watched.has(key(e))) ?? null;
    const newest = aired[aired.length - 1] ?? null;
    const cutoff = new Date(Date.now() - NEW_DAYS * 86400000).toISOString().slice(0, 10);
    const isNew = !!newest && !watched.has(key(newest)) && newest.airdate >= cutoff;
    return { newest, unwatched, isNew };
  };

  if (shows.length === 0) return null;
  const ordered = [...shows].sort((a, b) => Number(statusOf(b).isNew) - Number(statusOf(a).isNew));
  const scroll = (dir: 1 | -1) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.75, behavior: 'smooth' });

  return (
    <div className="section" data-testid="followed-shows">
      <div className="section-header"><h2 className="section-title">Your Shows</h2></div>
      <div className="movie-row-wrapper">
        <button className="row-scroll-btn left" onClick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" size={32} /></button>
        <div className="movie-row" ref={rowRef}>
          {ordered.map(s => {
            const st = statusOf(s);
            return (
              <div key={s.id} style={{ width: 160, flexShrink: 0, position: 'relative' }}>
                <SeriesCard show={s} posterUrl={ytsImage(s.poster)} onSelect={onSelect} onPlay={onPlay} />
                {st.isNew && <span className="new-episode-badge">New episode</span>}
                {st.unwatched && (
                  <div className="followed-next">Next: S{pad(st.unwatched.season)}E{pad(st.unwatched.number)}</div>
                )}
              </div>
            );
          })}
        </div>
        <button className="row-scroll-btn right" onClick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" size={32} /></button>
      </div>
    </div>
  );
}
