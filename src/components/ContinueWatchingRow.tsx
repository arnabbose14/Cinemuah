import { useState, useEffect, useRef, useCallback } from 'react';
import type { StreamHistoryItem } from '@/types';
import { Icon } from './Icon';
import { useYtsImage } from '@/pages/DiscoverPage';
import { useToast } from '@/contexts/ToastContext';

interface Props {
  onResume: (item: StreamHistoryItem) => void;
  /** Opens the movie / show details (qualities, episodes). */
  onOpen?: (item: StreamHistoryItem) => void;
}

// Survives leaving and returning to Home so the row paints instantly
let cached: StreamHistoryItem[] | null = null;

/** Titles streamed online that were left halfway, newest first. Renders nothing when there are none. */
export function ContinueWatchingRow({ onResume, onOpen }: Props) {
  const api = window.electronAPI.history;
  const ytsImage = useYtsImage();
  const { showToast } = useToast();
  const rowRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<StreamHistoryItem[]>(cached ?? []);

  const load = useCallback(() => {
    api?.list().then(l => { cached = l; setItems(l); }).catch(() => undefined);
  }, [api]);
  useEffect(load, [load]);

  if (!api || items.length === 0) return null;

  const dismiss = async (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    await api.remove(key).catch(() => undefined);
    load();
  };
  const download = async (e: React.MouseEvent, it: StreamHistoryItem) => {
    e.stopPropagation();
    try {
      await window.electronAPI.downloads.start(it.magnet, {
        title: it.kind === 'episode' ? `${it.title} S${String(it.season).padStart(2, '0')}E${String(it.episode).padStart(2, '0')}` : it.title,
        year: it.year, quality: it.quality, imdbId: it.imdbId,
        series: it.kind === 'episode' ? { showTitle: it.title, season: it.season, episode: it.episode } : undefined,
      });
      showToast(`Downloading ${it.title}. It will appear in your library when finished.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Download failed', 'error');
    }
  };
  const scroll = (dir: 1 | -1) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.75, behavior: 'smooth' });

  return (
    <div className="section" data-testid="continue-watching">
      <div className="section-header"><h2 className="section-title">Continue Watching</h2></div>
      <div className="movie-row-wrapper">
        <button className="row-scroll-btn left" onClick={() => scroll(-1)} aria-label="Scroll left"><Icon name="chevronLeft" size={32} /></button>
        <div className="movie-row" ref={rowRef}>
          {items.map(it => {
            const pct = it.duration > 0 ? Math.min(100, (it.position / it.duration) * 100) : 0;
            return (
              <div key={it.key} style={{ width: 160, flexShrink: 0 }}>
                <div className="movie-card" style={{ width: '100%' }} onClick={() => onResume(it)} title={`Resume ${it.title}`}>
                  <div className="movie-card-poster">
                    <div className="movie-card-poster-placeholder" style={{ display: 'flex' }}><span className="placeholder-title">{it.title}</span></div>
                    {it.poster && (
                      <img src={ytsImage(it.poster)} alt={it.title} decoding="async"
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    <div className="movie-card-overlay">
                      <div className="card-overlay-actions">
                        <button className="card-action-btn play" title="Resume"><Icon name="play" /></button>
                        <button className="card-action-btn list" title="Download to library" onClick={e => download(e, it)}><Icon name="download" /></button>
                        <button className="card-action-btn info" title="Open the title" onClick={e => { e.stopPropagation(); onOpen?.(it); }}><Icon name="info" /></button>
                      </div>
                      <div className="card-overlay-title">{it.title}</div>
                    </div>
                    <button className="resume-remove" title="Hide from Continue Watching" onClick={e => dismiss(e, it.key)}><Icon name="close" size={14} /></button>
                    <div className="resume-progress"><div style={{ width: `${pct}%` }} /></div>
                  </div>
                  <div className="movie-card-info">
                    <div className="movie-card-title">{it.title}</div>
                    <div className="movie-card-meta">{it.subtitle}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <button className="row-scroll-btn right" onClick={() => scroll(1)} aria-label="Scroll right"><Icon name="chevronRight" size={32} /></button>
      </div>
    </div>
  );
}
