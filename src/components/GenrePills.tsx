import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Icon } from './Icon';
import { kidsHiddenGenre } from '@/lib/kids';

interface GenrePillsProps {
  genres: { label: string; value: string }[];
  /** 'all' (or empty) means no filter. */
  selected: string;
  onSelect: (value: string) => void;
  allLabel?: string;
  /** Show the leading 'All' pill (filter pages). Home uses pills purely as shortcuts. */
  showAll?: boolean;
}

/** A horizontally scrolling row of genre shortcuts. */
export function GenrePills({ genres, selected, onSelect, allLabel = 'All', showAll = true }: GenrePillsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const current = selected || 'all';

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    window.addEventListener('resize', measure);
    el?.addEventListener('scroll', measure, { passive: true });
    return () => { window.removeEventListener('resize', measure); el?.removeEventListener('scroll', measure); };
  }, [measure, genres.length]);

  // keep the active pill in view (e.g. when a genre is picked on another page)
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.genre-pill.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [current]);

  const nudge = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' });

  return (
    <div className="genre-pills-wrap">
      {edges.left && <button className="genre-pills-arrow left" onClick={() => nudge(-1)} aria-label="Scroll genres left"><Icon name="chevronLeft" size={22} /></button>}
      <div className="genre-pills" ref={ref} role="tablist" aria-label="Genres">
        {showAll && (
          <button className={`genre-pill ${current === 'all' ? 'active' : ''}`} onClick={() => onSelect('all')} role="tab" aria-selected={current === 'all'}>
            {allLabel}
          </button>
        )}
        {genres.filter(g => !kidsHiddenGenre(g.value)).map(g => (
          <button
            key={g.value}
            className={`genre-pill ${current === g.value ? 'active' : ''}`}
            onClick={() => onSelect(showAll && current === g.value ? 'all' : g.value)}
            role="tab"
            aria-selected={current === g.value}
          >
            {g.label}
          </button>
        ))}
      </div>
      {edges.right && <button className="genre-pills-arrow right" onClick={() => nudge(1)} aria-label="Scroll genres right"><Icon name="chevronRight" size={22} /></button>}
    </div>
  );
}
