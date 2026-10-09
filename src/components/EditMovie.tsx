import React, { useState, useEffect } from 'react';
import type { Movie } from '@/types';
import { parseMovieGenres, formatDuration } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from './Icon';

interface EditMovieProps {
  movie: Movie;
  onSave: (updated: Partial<Movie>) => void;
  onClose: () => void;
  onRefreshMetadata?: () => void;
}

export function EditMovie({ movie, onSave, onClose, onRefreshMetadata }: EditMovieProps) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    title: movie.title,
    year: movie.year?.toString() || '',
    description: movie.description || '',
    poster: movie.poster || '',
    backdrop: movie.backdrop || '',
    rating: movie.rating?.toString() || '',
    director: movie.director || '',
    genres: parseMovieGenres(movie.genres).join(', '),
    cast: movie.cast || '',
    writers: movie.writers || '',
  });

  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ id: number; title: string; year?: number; poster?: string }>>([]);
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    window.electronAPI.settings.get('tmdbApiKey').then(key => setApiKey(key));
  }, []);

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const genres = form.genres.split(',').map(g => g.trim()).filter(Boolean);
    onSave({
      title: form.title,
      year: form.year ? parseInt(form.year) : undefined,
      description: form.description,
      poster: form.poster,
      backdrop: form.backdrop,
      rating: form.rating ? parseFloat(form.rating) : undefined,
      director: form.director,
      genres: JSON.stringify(genres),
    });
    showToast('Movie updated successfully!', 'success');
    onClose();
  };

  const handleTMDBSearch = async () => {
    if (!apiKey) {
      showToast('Enter TMDB API key in Settings first', 'error');
      return;
    }
    setSearching(true);
    try {
      const results = await window.electronAPI.metadata.search(form.title, form.year ? parseInt(form.year) : undefined);
      setSearchResults(results || []);
      if (!results || results.length === 0) {
        showToast('No results found', 'info');
      }
    } catch {
      showToast('Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectTMDB = async (tmdbId: number) => {
    if (!apiKey) return;
    try {
      const metadata = await window.electronAPI.metadata.fetch(tmdbId) as {
        title: string; year?: number; description: string; poster: string;
        backdrop: string; rating: number; duration: number; genres: string[];
        cast: string; director: string; writers: string;
      };
      if (metadata) {
        setForm(prev => ({
          ...prev,
          title: metadata.title,
          year: metadata.year?.toString() || prev.year,
          description: metadata.description,
          poster: metadata.poster,
          backdrop: metadata.backdrop,
          rating: metadata.rating?.toString() || prev.rating,
          director: metadata.director,
          genres: Array.isArray(metadata.genres) ? metadata.genres.join(', ') : prev.genres,
        }));
        setSearchResults([]);
        showToast('Metadata loaded!', 'success');
      }
    } catch {
      showToast('Failed to load metadata', 'error');
    }
  };

  return (
    <div className="edit-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="edit-modal">
        <div className="edit-modal-title">
          <span>Edit Movie</span>
          <button
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}
            onClick={onClose}
          ><Icon name="close" /></button>
        </div>

        <div className="edit-form">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Title</label>
              <input
                className="form-input"
                value={form.title}
                onChange={e => handleChange('title', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Year</label>
              <input
                className="form-input"
                type="number"
                min="1888"
                max="2030"
                value={form.year}
                onChange={e => handleChange('year', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea
              className="form-textarea"
              value={form.description}
              onChange={e => handleChange('description', e.target.value)}
              rows={3}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Rating (0–10)</label>
              <input
                className="form-input"
                type="number"
                min="0"
                max="10"
                step="0.1"
                value={form.rating}
                onChange={e => handleChange('rating', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Director</label>
              <input
                className="form-input"
                value={form.director}
                onChange={e => handleChange('director', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Genres (comma-separated)</label>
            <input
              className="form-input"
              value={form.genres}
              onChange={e => handleChange('genres', e.target.value)}
              placeholder="Action, Drama, Thriller"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Poster URL</label>
            <input
              className="form-input"
              value={form.poster}
              onChange={e => handleChange('poster', e.target.value)}
              placeholder="https://..."
            />
          </div>

          <div className="form-group">
            <label className="form-label">Backdrop URL</label>
            <input
              className="form-input"
              value={form.backdrop}
              onChange={e => handleChange('backdrop', e.target.value)}
              placeholder="https://..."
            />
          </div>

          {/* TMDB Search */}
          {apiKey && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleTMDBSearch}
                  disabled={searching}
                >
                  {searching ? 'Searching...' : 'Search TMDB'}
                </button>
                {onRefreshMetadata && (
                  <button className="btn btn-ghost btn-sm" onClick={() => { onRefreshMetadata(); onClose(); }}>
                    <Icon name="refresh" /> Auto-Refresh
                  </button>
                )}
              </div>
              {searchResults.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {searchResults.map(result => (
                    <button
                      key={result.id}
                      onClick={() => handleSelectTMDB(result.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {result.poster && (
                        <img src={result.poster} alt={result.title} style={{ width: 40, height: 60, objectFit: 'cover', borderRadius: 4 }} />
                      )}
                      <div>
                        <div style={{ fontWeight: 700 }}>{result.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{result.year}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', paddingTop: 8 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-accent" onClick={handleSave}>Save Changes</button>
          </div>
        </div>
      </div>
    </div>
  );
}
