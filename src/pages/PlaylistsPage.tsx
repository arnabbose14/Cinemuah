import { useState, useEffect, useCallback } from 'react';
import type { Movie, PlaylistSummary, PlaylistItem, YtsMovie, YtsTorrent, SeriesShow } from '@/types';
import { pickDefaultTorrent } from '@/types';
import { MovieCard } from '@/components/MovieCard';
import { Icon } from '@/components/Icon';
import { useToast } from '@/contexts/ToastContext';
import { YtsCard, YtsDetail, TorrentPlayer, useYtsImage } from '@/pages/DiscoverPage';
import { SeriesCard, SeriesDetail, useSeriesActions } from '@/pages/SeriesPage';
import { movieStream } from '@/lib/streams';

const clean = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong';

interface Props {
  localMovies: Movie[];
  onPlay: (movie: Movie, startPosition?: number) => void;
  onDetail: (movie: Movie) => void;
  onToggleList: (movie: Movie) => void;
}

const parse = <T,>(s: string): T | null => { try { return JSON.parse(s) as T; } catch { return null; } };

export function PlaylistsPage({ localMovies, onPlay, onDetail, onToggleList }: Props) {
  const api = window.electronAPI.playlists;
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const seriesActions = useSeriesActions();

  const [lists, setLists] = useState<PlaylistSummary[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const [selMovie, setSelMovie] = useState<YtsMovie | null>(null);
  const [selShow, setSelShow] = useState<SeriesShow | null>(null);
  const [streaming, setStreaming] = useState<{ movie: YtsMovie; torrent: YtsTorrent } | null>(null);

  const loadLists = useCallback(() => { api?.list().then(setLists).catch(() => undefined); }, [api]);
  const loadItems = useCallback((id: number) => { api?.items(id).then(setItems).catch(() => undefined); }, [api]);
  useEffect(loadLists, [loadLists]);
  useEffect(() => { if (openId !== null) loadItems(openId); }, [openId, loadItems]);

  if (!api) return null;
  const open = lists.find(l => l.id === openId) ?? null;

  const create = async () => {
    const n = newName.trim();
    if (!n) return;
    try { await api.create(n); setNewName(''); setCreating(false); loadLists(); } catch (err) { showToast(clean(err), 'error'); }
  };
  const rename = async () => {
    const n = renameVal.trim();
    if (!open || !n) return;
    try { await api.rename(open.id, n); setRenaming(false); loadLists(); } catch (err) { showToast(clean(err), 'error'); }
  };
  const deleteList = async () => {
    if (!open || !window.confirm(`Delete playlist "${open.name}"? The titles in it are not deleted.`)) return;
    await api.delete(open.id);
    setOpenId(null); loadLists();
  };
  const takeOut = async (key: string) => {
    if (!open) return;
    await api.remove(open.id, key);
    loadItems(open.id); loadLists();
  };

  const download = async (movie: YtsMovie, torrent: YtsTorrent) => {
    try {
      await window.electronAPI.downloads.start(torrent.magnet, { title: movie.title, year: movie.year, quality: torrent.quality, imdbId: movie.imdbCode });
      showToast(`Downloading ${movie.title} (${torrent.quality}). It will appear in your library when finished.`, 'success');
    } catch (err) { showToast(clean(err), 'error'); }
  };

  if (seriesActions.player) return seriesActions.player;
  if (streaming) {
    return (
      <TorrentPlayer
        spec={movieStream(streaming.movie, streaming.torrent)}
        onClose={() => setStreaming(null)}
        onError={msg => { showToast(msg, 'error'); setStreaming(null); }}
      />
    );
  }

  const header = (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em', marginBottom: 4 }}>Playlists</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Your own collections of movies and series.</p>
    </div>
  );

  if (!open) {
    return (
      <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
        {header}
        <div style={{ marginBottom: 24 }}>
          {creating ? (
            <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); create(); }}>
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="Playlist name" maxLength={60}
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: '#fff', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 14, width: 260 }} />
              <button className="btn btn-primary" type="submit" disabled={!newName.trim()}>Create</button>
              <button className="btn btn-ghost" type="button" onClick={() => { setCreating(false); setNewName(''); }}>Cancel</button>
            </form>
          ) : (
            <button className="btn btn-secondary" onClick={() => setCreating(true)}><Icon name="plus" /> New playlist</button>
          )}
        </div>

        {lists.length === 0 ? (
          <div className="empty-state" style={{ paddingTop: 60 }}>
            <div className="empty-icon"><Icon name="playlistAdd" /></div>
            <h2 className="empty-title">No playlists yet</h2>
            <p className="empty-subtitle">Create one, then use Playlist on any movie or series to save it here.</p>
          </div>
        ) : (
          <div className="playlist-grid">
            {lists.map(l => (
              <button key={l.id} className="playlist-tile" onClick={() => setOpenId(l.id)}>
                <div className="playlist-cover">
                  {l.posters.length === 0
                    ? <div className="playlist-cover-empty"><Icon name="playlistAdd" size={32} /></div>
                    : l.posters.slice(0, 4).map((p, i) => <img key={i} src={ytsImage(p)} alt="" />)}
                </div>
                <div className="playlist-tile-name">{l.name}</div>
                <div className="playlist-tile-count">{l.count} title{l.count === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: 'calc(var(--nav-height) + var(--titlebar-offset, 28px) + 24px) 48px 48px' }}>
      <div className="playlist-head">
        <button className="icon-btn" onClick={() => { setOpenId(null); setRenaming(false); loadLists(); }} title="All playlists"><Icon name="back" size={24} /></button>
        {renaming ? (
          <form style={{ display: 'flex', gap: 8 }} onSubmit={e => { e.preventDefault(); rename(); }}>
            <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)} maxLength={60} />
            <button className="btn btn-primary" type="submit">Save</button>
            <button className="btn btn-ghost" type="button" onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-0.04em' }}>{open.name}</h1>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>{items.length} title{items.length === 1 ? '' : 's'}</span>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setRenameVal(open.name); setRenaming(true); }}><Icon name="edit" /> Rename</button>
            <button className="btn btn-ghost btn-sm" onClick={deleteList}><Icon name="trash" /> Delete</button>
          </>
        )}
      </div>

      {items.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-icon"><Icon name="playlistAdd" /></div>
          <h2 className="empty-title">This playlist is empty</h2>
          <p className="empty-subtitle">Open a movie or series and choose Playlist to add it.</p>
        </div>
      )}

      <div className="search-results-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        {items.map(it => {
          const card = (() => {
            if (it.kind === 'yts') {
              const m = parse<YtsMovie>(it.payload);
              if (!m || !Array.isArray(m.torrents)) return null;
              const play = () => { const t = pickDefaultTorrent(m.torrents); if (t) setStreaming({ movie: m, torrent: t }); else setSelMovie(m); };
              return <YtsCard movie={m} posterUrl={ytsImage(m.poster)} onSelect={setSelMovie} onStream={play}
                onDownload={() => { const t = pickDefaultTorrent(m.torrents); if (t) download(m, t); else setSelMovie(m); }} />;
            }
            if (it.kind === 'series') {
              const s = parse<SeriesShow>(it.payload);
              return s && Array.isArray(s.genres) ? <SeriesCard show={s} posterUrl={ytsImage(s.poster)} onSelect={setSelShow} onPlay={seriesActions.playShow} /> : null;
            }
            const id = parse<{ id: number }>(it.payload)?.id;
            const movie = localMovies.find(m => m.id === id);
            return movie ? <MovieCard movie={movie} onPlay={onPlay} onDetail={onDetail} onToggleList={onToggleList} /> : (
              <div className="movie-card"><div className="movie-card-poster"><div className="movie-card-poster-placeholder" style={{ display: 'flex' }}><span className="placeholder-title">{it.title} (no longer in library)</span></div></div></div>
            );
          })();
          if (!card) return null;
          return (
            <div key={it.key} style={{ position: 'relative' }}>
              {card}
              <button className="resume-remove" style={{ display: 'flex' }} title="Take out of playlist" onClick={() => takeOut(it.key)}><Icon name="close" size={14} /></button>
            </div>
          );
        })}
      </div>

      {selMovie && (
        <YtsDetail movie={selMovie} onClose={() => setSelMovie(null)}
          onStream={(m, t) => { setSelMovie(null); setStreaming({ movie: m, torrent: t }); }} onDownload={download} />
      )}
      {selShow && (
        <SeriesDetail show={selShow} onClose={() => setSelShow(null)}
          onStream={(s, ep, t) => { setSelShow(null); seriesActions.stream(s, ep, t); }} onDownload={seriesActions.download} />
      )}
    </div>
  );
}
