import { useState, useEffect } from 'react';
import type { Movie, YtsMovie, MovieSearchResult } from '@/types';
import { Icon } from './Icon';
import { useToast } from '@/contexts/ToastContext';
import { useYtsImage } from '@/pages/DiscoverPage';

const clean = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong';

interface Candidate { id: string; title: string; year?: number; poster: string; overview: string; apply: () => Promise<void> }

/** Pick the right film when the library matched a file to the wrong poster or details. */
export function FixMatch({ movie, onClose, onFixed }: { movie: Movie; onClose: () => void; onFixed: () => void }) {
  const { showToast } = useToast();
  const ytsImage = useYtsImage();
  const [query, setQuery] = useState(movie.title);
  const [year, setYear] = useState(movie.year ? String(movie.year) : '');
  const [results, setResults] = useState<Candidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [source, setSource] = useState<'tmdb' | 'catalogue'>('catalogue');
  const [searched, setSearched] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const key = await window.electronAPI.settings.get('tmdbApiKey');
      const y = Number(year) || undefined;
      if (key) {
        setSource('tmdb');
        const found: MovieSearchResult[] = (await window.electronAPI.metadata.search(q, y)) ?? [];
        setResults(found.slice(0, 12).map(r => ({
          id: `t${r.id}`, title: r.title, year: r.year, poster: r.poster || '', overview: r.overview || '',
          apply: async () => {
            const m: any = await window.electronAPI.metadata.fetch(r.id);
            if (!m) throw new Error('Could not load details for that title');
            await window.electronAPI.movies.update(movie.id, {
              title: m.title, year: m.year, description: m.description, poster: m.poster, backdrop: m.backdrop, rating: m.rating,
              duration: m.duration, genres: m.genres, cast: m.cast, director: m.director, writers: m.writers, tmdbId: m.tmdbId,
            });
          },
        })));
      } else {
        setSource('catalogue');
        const r = await window.electronAPI.yts.list({ query: q, limit: 12, page: 1 });
        setResults(r.movies.map((m: YtsMovie) => ({
          id: `y${m.id}`, title: m.title, year: m.year, poster: m.poster, overview: m.summary,
          apply: async () => {
            await window.electronAPI.movies.update(movie.id, {
              title: m.title, year: m.year, description: m.summary, poster: m.poster, backdrop: m.backdrop, rating: m.rating,
              duration: m.runtime, genres: m.genres,
            });
          },
        })));
      }
    } catch (err) {
      showToast(clean(err), 'error');
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  const choose = async (c: Candidate) => {
    setApplying(c.id);
    try {
      await c.apply();
      showToast(`Matched to ${c.title}${c.year ? ` (${c.year})` : ''}`, 'success');
      onFixed();
      onClose();
    } catch (err) {
      showToast(clean(err), 'error');
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="movie-detail-overlay" style={{ zIndex: 2200 }} onClick={onClose}>
      <div className="movie-detail fix-match" onClick={e => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose}><Icon name="close" /></button>
        <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Fix match</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
          File: {movie.fileName}. Search for the right title and pick it to replace the poster and details.
        </p>
        <form style={{ display: 'flex', gap: 8, marginBottom: 20 }} onSubmit={e => { e.preventDefault(); search(); }}>
          <input className="settings-input" style={{ flex: 1 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="Title" />
          <input className="settings-input" style={{ width: 90 }} value={year} onChange={e => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Year" />
          <button className="btn btn-primary" type="submit" disabled={searching}>{searching ? 'Searching...' : 'Search'}</button>
        </form>

        {searched && results.length === 0 && !searching && <p style={{ color: 'var(--text-muted)' }}>No matches. Try a shorter title.</p>}
        <div className="fix-match-grid">
          {results.map(c => (
            <button key={c.id} className="fix-match-item" disabled={!!applying} onClick={() => choose(c)} title={c.overview}>
              <div className="fix-match-poster">
                {c.poster && <img src={source === 'catalogue' ? ytsImage(c.poster) : c.poster} alt="" />}
              </div>
              <div className="fix-match-title">{c.title}</div>
              <div className="fix-match-year">{applying === c.id ? 'Applying...' : c.year || ''}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
