import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PlaylistItem, PlaylistSummary } from '@/types';
import { Icon } from './Icon';
import { useToast } from '@/contexts/ToastContext';

type SaveItem = Omit<PlaylistItem, 'addedAt'>;

const clean = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong';

/** "Save to playlist" button with a popover to tick playlists or create a new one. Hidden where playlists aren't supported. */
export function SaveToPlaylist({ item, compact = false, large = false }: { item: SaveItem; compact?: boolean; large?: boolean }) {
  const api = window.electronAPI.playlists;
  const { showToast } = useToast();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [lists, setLists] = useState<PlaylistSummary[]>([]);
  const [member, setMember] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState(false);
  const [name, setName] = useState('');

  const refresh = useCallback(async () => {
    if (!api) return;
    const [l, m] = await Promise.all([api.list(), api.membership(item.key)]);
    setLists(l); setMember(new Set(m)); setSaved(m.length > 0);
  }, [api, item.key]);

  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 280;
    setPos({ top: Math.min(r.bottom + 8, window.innerHeight - 340), left: Math.max(12, Math.min(r.left, window.innerWidth - width - 12)) });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  if (!api) return null;

  const toggle = async (p: PlaylistSummary) => {
    try {
      if (member.has(p.id)) { await api.remove(p.id, item.key); showToast(`Removed from ${p.name}`, 'success'); }
      else { await api.add(p.id, item); showToast(`Saved to ${p.name}`, 'success'); }
      await refresh();
    } catch (err) { showToast(clean(err), 'error'); }
  };

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      const p = await api.create(n);
      await api.add(p.id, item);
      setName('');
      showToast(`Saved to ${p.name}`, 'success');
      await refresh();
    } catch (err) { showToast(clean(err), 'error'); }
  };

  return (
    <>
      <button
        ref={btnRef}
        className={`btn ${compact ? 'btn-sm' : large ? 'btn-lg' : ''} ${saved ? 'btn-secondary' : 'btn-ghost'}`}
        title="Save to playlist"
        onClick={e => { e.stopPropagation(); place(); setOpen(o => !o); refresh().catch(() => undefined); }}
      >
        <Icon name={saved ? 'playlistCheck' : 'playlistAdd'} /> {saved ? 'Saved' : 'Playlist'}
      </button>
      {open && createPortal(
        <div ref={popRef} className="playlist-pop" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
          <div className="playlist-pop-title">Save to playlist</div>
          <div className="playlist-pop-list">
            {lists.length === 0 && <div className="playlist-pop-empty">No playlists yet. Create one below.</div>}
            {lists.map(p => (
              <button key={p.id} className="playlist-pop-row" onClick={() => toggle(p)}>
                <span className={`playlist-check ${member.has(p.id) ? 'on' : ''}`}>{member.has(p.id) && <Icon name="check" size={14} />}</span>
                <span className="playlist-pop-name">{p.name}</span>
                <span className="playlist-pop-count">{p.count}</span>
              </button>
            ))}
          </div>
          <form className="playlist-pop-new" onSubmit={e => { e.preventDefault(); create(); }}>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="New playlist name"
              maxLength={60}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Create</button>
          </form>
        </div>,
        document.body
      )}
    </>
  );
}
