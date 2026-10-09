import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { SeriesShow, SeriesDetail as SeriesDetailData, SeriesEpisode, SeriesTorrent } from '@/types';
import { pickDefaultEpisodeTorrent } from '@/types';
import { TorrentPlayer, useYtsImage } from '@/pages/DiscoverPage';
import { useToast } from '@/contexts/ToastContext';
import { useLanguages, matchesLanguageName } from '@/lib/languages';
import { Icon } from '@/components/Icon';
import { episodeStream, specFromHistory, type StreamSpec } from '@/lib/streams';
import { GenrePills } from '@/components/GenrePills';
import { GENRE_PILLS, showHasGenre } from '@/lib/genres';
import { SaveToPlaylist } from '@/components/SaveToPlaylist';
import { useWatched } from '@/lib/watched';
import { kidsAllowed } from '@/lib/kids';
import { useFollows, toggleFollow } from '@/lib/follows';

const PAGE_SIZE = 12; // small first page = quick first paint; further pages load two at a time
const cleanError = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback;

const pad = (n: number) => String(n).padStart(2, '0');

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
};

// ─── Shared stream / download actions ───────────────────────────────

/** Stream + download handlers for episodes, shared by the Series page and the Home row. */
export function useSeriesActions() {
  const { showToast } = useToast();
  const [streaming, setStreaming] = useState<StreamSpec | null>(null);

  const stream = (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent) => {
    setStreaming(episodeStream(show, ep, torrent));
  };

  const download = async (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent): Promise<boolean> => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, {
        title: `${show.title} S${pad(ep.season)}E${pad(ep.number)}`,
        year: show.year,
        quality: torrent.quality,
        imdbId: show.imdbId,
        series: { showTitle: show.title, season: ep.season, episode: ep.number },
      });
      return true;
    } catch (err) {
      showToast(cleanError(err, 'Download failed'), 'error');
      return false;
    }
  };

  const player = streaming ? (
    <TorrentPlayer
      spec={streaming}
      onClose={() => setStreaming(null)}
      onError={msg => { showToast(msg, 'error'); setStreaming(null); }}
    />
  ) : null;

  /** Play button on a show: resume the episode in progress, else the next unwatched one (the first if none). */
  const playShow = async (show: SeriesShow): Promise<boolean> => {
    try {
      const inProgress = (await window.electronAPI.history?.list())?.find(h => h.key.startsWith(`ep:${show.id}:`));
      if (inProgress) { setStreaming({ ...specFromHistory(inProgress), episode: undefined }); return true; }
      const detail = await window.electronAPI.series.get(show.id);
      const today = new Date().toISOString().slice(0, 10);
      const aired = detail.episodes
        .filter(e => e.torrents.length > 0 && (!e.airdate || e.airdate <= today))
        .sort((a, b) => a.season - b.season || a.number - b.number);
      if (aired.length === 0) { showToast(`No episodes of ${show.title} are available to stream yet`, 'error'); return false; }
      const watched = new Set((await window.electronAPI.history?.watched()) ?? []);
      const key = (e: SeriesEpisode) => `ep:${show.id}:${e.season}x${e.number}`;
      let furthest = -1;
      aired.forEach((e, i) => { if (watched.has(key(e))) furthest = i; });
      const next = aired[furthest + 1] ?? aired[aired.length - 1];
      const torrent = pickDefaultEpisodeTorrent(next.torrents);
      if (!torrent) { showToast('No source with peers for that episode', 'error'); return false; }
      stream(detail.show, next, torrent);
      return true;
    } catch (err) {
      showToast(cleanError(err, 'Could not start playback'), 'error');
      return false;
    }
  };

  return { stream, download, player, playShow };
}

// ─── Card ───────────────────────────────────────────────────────────

export function SeriesCard({ show, posterUrl, onSelect, onPlay }: { show: SeriesShow; posterUrl: string; onSelect: (s: SeriesShow) => void; onPlay?: (s: SeriesShow) => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="movie-card" style={{ width: '100%' }} onClick={() => onSelect(show)}>
      <div className="movie-card-poster">
        <div className="movie-card-poster-placeholder" style={{ display: 'flex' }}>
          <span className="placeholder-title">{show.title}</span>
        </div>
        {posterUrl && (
          <img
            src={posterUrl}
            alt={show.title}
            decoding="async"
            onLoad={() => setLoaded(true)}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
              opacity: loaded ? 1 : 0, transition: 'opacity 250ms ease',
            }}
          />
        )}
        <div className="movie-card-overlay">
          <div className="card-overlay-actions">
            <button className="card-action-btn play" title={onPlay ? 'Play' : 'Episodes'} onClick={e => { e.stopPropagation(); (onPlay ?? onSelect)(show); }}>
              <Icon name="play" />
            </button>
            <button className="card-action-btn list" title="Download episodes" onClick={e => { e.stopPropagation(); onSelect(show); }}>
              <Icon name="download" />
            </button>
            <button className="card-action-btn info" title="Details and episodes" onClick={e => { e.stopPropagation(); onSelect(show); }}>
              <Icon name="info" />
            </button>
          </div>
          <div className="card-overlay-title">{show.title}</div>
          <div className="card-overlay-meta">
            <span>{show.year || ''}</span>
            {show.rating > 0 && <span> · <Icon name="star" size={12} /> {show.rating.toFixed(1)}</span>}
          </div>
        </div>
      </div>
      <div className="movie-card-info">
        <div className="movie-card-title">{show.title}</div>
        <div className="movie-card-meta">{[show.year || null, show.network || null].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

// ─── Detail ─────────────────────────────────────────────────────────

const QUALITIES = ['auto', '2160p', '1080p', '720p', '480p'];

export function SeriesDetail({ show, onClose, onStream, onDownload }: {
  show: SeriesShow;
  onClose: () => void;
  onStream: (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent) => void;
  onDownload: (show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent) => Promise<boolean>;
}) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const [detail, setDetail] = useState<SeriesDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [quality, setQuality] = useState('auto');
  const [reloadKey, setReloadKey] = useState(0);
  const watched = useWatched();
  const following = useFollows().some(f => f.showId === show.id);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    window.electronAPI.series.get(show.id)
      .then(d => {
        if (cancelled) return;
        setDetail(d);
        // Open on the newest season that has something to watch
        const withTorrents = d.episodes.filter(e => e.torrents.length > 0).map(e => e.season);
        const all = d.episodes.map(e => e.season);
        setSeason(withTorrents.length ? Math.max(...withTorrents) : all.length ? Math.max(...all) : null);
      })
      .catch(err => { if (!cancelled) setError(cleanError(err, 'Could not load episodes')); });
    return () => { cancelled = true; };
  }, [show.id, reloadKey]);

  const seasons = useMemo(
    () => Array.from(new Set((detail?.episodes ?? []).map(e => e.season))).sort((a, b) => a - b),
    [detail]
  );
  const episodes = useMemo(
    () => (detail?.episodes ?? []).filter(e => e.season === season).sort((a, b) => a.number - b.number),
    [detail, season]
  );

  const choose = (ep: SeriesEpisode): SeriesTorrent | undefined => {
    if (quality !== 'auto') {
      const wanted = ep.torrents
        .filter(t => t.quality === quality && (t.seeds > 0 || t.peers > 0))
        .sort((a, b) => (b.seeds * 2 + b.peers) - (a.seeds * 2 + a.peers))[0];
      if (wanted) return wanted;
    }
    return pickDefaultEpisodeTorrent(ep.torrents);
  };

  const downloadSeason = async () => {
    const targets = episodes.map(ep => ({ ep, t: choose(ep) })).filter((x): x is { ep: SeriesEpisode; t: SeriesTorrent } => !!x.t);
    if (targets.length === 0) { showToast('No episodes with peers in this season', 'error'); return; }
    let ok = 0;
    for (const { ep, t } of targets) if (await onDownload(show, ep, t)) ok++;
    if (ok > 0) showToast(`Downloading ${ok} episode${ok === 1 ? '' : 's'} of ${show.title} season ${season}. They will appear in your library when finished.`, 'success');
  };

  const downloadOne = async (ep: SeriesEpisode, t: SeriesTorrent) => {
    if (await onDownload(show, ep, t)) {
      showToast(`Downloading ${show.title} S${pad(ep.season)}E${pad(ep.number)} (${t.quality})`, 'success');
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const availableCount = episodes.filter(e => choose(e)).length;

  return (
    <div className="movie-detail-overlay" onClick={onClose}>
      <div className="movie-detail" onClick={e => e.stopPropagation()} style={{ maxWidth: 980 }}>
        <div style={{ position: 'relative', display: 'flex', gap: 28, padding: '36px 40px 20px' }}>
          <button className="detail-close" onClick={onClose}><Icon name="close" /></button>
          <div style={{ width: 170, flexShrink: 0, aspectRatio: '2 / 3', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
            {show.posterLarge && (
              <img src={ytsImage(show.posterLarge)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="detail-title" style={{ fontSize: 34 }}>{show.title}</h1>
            <div className="detail-meta">
              {show.year > 0 && <span>{show.year}</span>}
              {show.status && <span>{show.status}</span>}
              {show.rating > 0 && <span><Icon name="star" size={14} /> {show.rating.toFixed(1)}</span>}
              {show.network && <span>{show.network}</span>}
              {show.genres.length > 0 && <span>{show.genres.slice(0, 3).join(' · ')}</span>}
            </div>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, fontSize: 14, maxHeight: 130, overflow: 'auto' }}>
              {show.summary || 'No synopsis available.'}
            </p>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {window.electronAPI.follows && (
                <button className={`btn btn-sm ${following ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggleFollow(show, following)}
                  title={following ? 'Stop following this show' : 'Follow to see new episodes on Home'}>
                  <Icon name={following ? 'check' : 'plus'} /> {following ? 'Following' : 'Follow'}
                </button>
              )}
              <SaveToPlaylist compact item={{ key: `series:${show.id}`, kind: 'series', title: show.title, year: show.year, poster: show.poster, payload: JSON.stringify(show) }} />
            </div>
          </div>
        </div>

        <div style={{ padding: '0 40px 40px' }}>
          {error && (
            <div style={{ padding: '24px 0', color: 'var(--text-muted)' }}>
              <p style={{ marginBottom: 12 }}>{error}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
            </div>
          )}

          {!error && !detail && (
            <div className="empty-state" style={{ padding: '40px 0' }}><div className="spinner" /></div>
          )}

          {detail?.notice && !detail.sourcesError && (
            <div className="sources-warning"><Icon name="info" size={16} /><span>{detail.notice}</span></div>
          )}
          {detail?.sourcesError && (
            <div className="sources-warning">
              <Icon name="warning" size={16} />
              <span>The episode list loaded, but the torrent source couldn't be reached, so nothing can be played or downloaded yet.</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setReloadKey(k => k + 1)}>Retry</button>
            </div>
          )}

          {detail && seasons.length === 0 && <p style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No episodes listed for this show.</p>}

          {detail && seasons.length > 0 && (
            <>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 16px' }}>
                <select value={season ?? ''} onChange={e => setSeason(Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {seasons.map(s => <option key={s} value={s}>Season {s}</option>)}
                </select>
                <select value={quality} onChange={e => setQuality(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} title="Preferred quality">
                  {QUALITIES.map(q => <option key={q} value={q}>{q === 'auto' ? 'Quality: Auto (1080p first)' : q}</option>)}
                </select>
                <button className="btn btn-secondary btn-sm" disabled={availableCount === 0} onClick={downloadSeason} style={{ marginLeft: 'auto' }}>
                  <Icon name="download" /> Download season ({availableCount})
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {episodes.map(ep => {
                  const t = choose(ep);
                  return (
                    <div
                      key={`${ep.season}x${ep.number}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 14, padding: '10px 14px',
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                      }}
                    >
                      <span style={{ width: 34, color: 'var(--text-muted)', fontWeight: 700, textAlign: 'center' }}>{ep.number}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ep.name || `Episode ${ep.number}`}
                          {watched.has(`ep:${show.id}:${ep.season}x${ep.number}`) && <span className="episode-watched" title="Watched"><Icon name="check" size={14} /></span>}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {ep.airdate && ep.airdate > today ? `Airs ${ep.airdate}` : ep.airdate}
                          {t && <> · {t.quality}{t.codec ? ` ${t.codec}` : ''} · {t.size} · {t.seeds} seeds</>}
                          {!t && ep.airdate && ep.airdate <= today && <> · No torrents with peers</>}
                        </div>
                      </div>
                      {t && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary btn-sm" onClick={() => onStream(show, ep, t)} title={`Stream ${t.quality}`}>
                            <Icon name="play" /> Play
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => downloadOne(ep, t)} title="Download to library">
                            <Icon name="download" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

interface FeedState { shows: SeriesShow[]; total: number; page: number }
const feedCache = new Map<string, FeedState>();

export function SeriesPage() {
  const ytsImage = useYtsImage();
  const { languages, ready: languagesReady } = useLanguages();
  const { stream, download, player, playShow } = useSeriesActions();
  const debouncedQuery = ''; // searching is global (navbar), this page only browses
  const feedKey = debouncedQuery.toLowerCase();
  const initial = feedCache.get(feedKey);
  const [shows, setShows] = useState<SeriesShow[]>(initial?.shows ?? []);
  const [total, setTotal] = useState(initial?.total ?? 0);
  const [page, setPage] = useState(initial?.page ?? 0);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SeriesShow | null>(null);
  const [genre, setGenre] = useState('all');
  const requestId = useRef(0);
  const loadingRef = useRef(false);

  /** Starts `count` consecutive pages together and shows each one the moment it (and the ones before it) arrive. */
  const loadPage = useCallback(async (pageToLoad: number, append: boolean, count = 1) => {
    const id = ++requestId.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const requests = Array.from({ length: count }, (_, i) =>
        window.electronAPI.series.list({ query: debouncedQuery, page: pageToLoad + i, limit: PAGE_SIZE }).then(r => ({ r }), err => ({ err })));
      const merged = append ? [...(feedCache.get(feedKey)?.shows ?? [])] : [];
      const seen = new Set(merged.map(s => s.id));
      for (let i = 0; i < requests.length; i++) {
        const res = await requests[i];
        if (id !== requestId.current) return;
        if ('err' in res) { if (i === 0) throw res.err; break; } // later pages that fail are simply retried next time
        const r = res.r;
        for (const s of r.shows) if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); if (s.poster) new Image().src = ytsImage(s.poster); }
        feedCache.set(feedKey, { shows: [...merged], total: r.total, page: pageToLoad + i });
        setShows([...merged]); setTotal(r.total); setPage(pageToLoad + i);
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setError(cleanError(err, 'Failed to load series'));
    } finally {
      if (id === requestId.current) { loadingRef.current = false; setLoading(false); }
    }
  }, [debouncedQuery, feedKey, ytsImage]);

  useEffect(() => {
    const cached = feedCache.get(feedKey);
    if (cached) {
      setShows(cached.shows); setTotal(cached.total); setPage(cached.page); setLoading(false); setError(null);
      loadingRef.current = false;
    } else {
      setShows([]); setTotal(0); setPage(0);
      loadPage(1, false);
    }
  }, [feedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pool size is known up front for trending; search results come back in one page.
  const hasMore = page > 0 && !debouncedQuery && page * PAGE_SIZE < total;
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || error || !languagesReady) return;
    const io = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !loadingRef.current) loadPage(page + 1, true, 2);
    }, { root: el.closest('.main-content'), rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, error, languagesReady, page, loadPage, loading]);

  // Keep pulling the rest of the library in the background so the whole catalogue is there without having to scroll for it
  useEffect(() => {
    if (!hasMore || loading || error || !languagesReady) return;
    const timer = setTimeout(() => { if (!loadingRef.current) loadPage(page + 1, true, 2); }, 350);
    return () => clearTimeout(timer);
  }, [hasMore, loading, error, languagesReady, page, loadPage]);

  // The catalogue keeps growing for a short while after a first launch (it is crawled in the background): check back
  useEffect(() => {
    if (hasMore || loading || error || !languagesReady || page === 0 || debouncedQuery) return;
    let checks = 0;
    const timer = setInterval(() => {
      if (loadingRef.current || ++checks > 18) { if (checks > 18) clearInterval(timer); return; }
      loadPage(page + 1, true, 2);
    }, 8000);
    return () => clearInterval(timer);
  }, [hasMore, loading, error, languagesReady, page, debouncedQuery, loadPage]);

  const visible = useMemo(
    () => (languagesReady ? shows.filter(s => matchesLanguageName(s.language, languages) && kidsAllowed(s.genres) && showHasGenre(s, genre)) : []),
    [shows, languages, languagesReady, genre]
  );

  if (player) return player;

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 4 }}>Series</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
          Popular right now. Stream or download any episode.
        </p>
      </div>

      <GenrePills genres={GENRE_PILLS} selected={genre} onSelect={setGenre} />

      {error && visible.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="warning" /></div>
          <h2 className="empty-title">Couldn't load series</h2>
          <p className="empty-subtitle">{error}</p>
          <button className="btn btn-accent" style={{ marginTop: 16 }} onClick={() => loadPage(1, false)}>Retry</button>
        </div>
      )}

      {!error && visible.length === 0 && !loading && !hasMore && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="search" /></div>
          <h2 className="empty-title">No series found</h2>
          <p className="empty-subtitle">Try a different search, or check your language settings.</p>
        </div>
      )}

      <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {visible.map(show => (
          <SeriesCard key={show.id} show={show} posterUrl={ytsImage(show.poster)} onSelect={setSelected} onPlay={playShow} />
        ))}
        {(loading || !languagesReady) && Array.from({ length: visible.length === 0 ? 12 : 6 }, (_, i) => (
          <div key={`s${i}`} className="movie-card" style={{ width: '100%' }}>
            <div className="movie-card-poster yts-skeleton" />
            <div className="movie-card-info">
              <div className="yts-skeleton-line" style={{ width: '80%' }} />
              <div className="yts-skeleton-line" style={{ width: '40%', marginTop: 6 }} />
            </div>
          </div>
        ))}
      </div>

      <div ref={sentinelRef} style={{ height: 1 }} />

      {selected && (
        <SeriesDetail
          show={selected}
          onClose={() => setSelected(null)}
          onStream={(s, ep, t) => { setSelected(null); stream(s, ep, t); }}
          onDownload={download}
        />
      )}
    </div>
  );
}
