import React, { useState, useEffect } from 'react';
import type { Movie } from '@/types';
import { formatBytes } from '@/types';
import { Icon } from './Icon';
import { useToast } from '@/contexts/ToastContext';

const SPEEDS: [string, string][] = [['0', 'Unlimited'], ['512', '512 KB/s'], ['1024', '1 MB/s'], ['2048', '2 MB/s'], ['5120', '5 MB/s'], ['10240', '10 MB/s']];
const SUB_LANGS: [string, string][] = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['ru', 'Russian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['tr', 'Turkish'],
];

const set = (k: string, v: string) => window.electronAPI.settings.set(k, v);

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  );
}

/** A label + description on the left and its control on the right. */
export function SettingRow({ title, hint, children, stacked = false }: { title: string; hint?: React.ReactNode; children?: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={`setting-row ${stacked ? 'stacked' : ''}`}>
      <div className="setting-row-text">
        <div className="setting-row-title">{title}</div>
        {hint && <div className="setting-row-hint">{hint}</div>}
      </div>
      {children && <div className="setting-row-control">{children}</div>}
    </div>
  );
}

const normTitle = (t: string) => t.toLowerCase().replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '');

interface DupGroup { key: string; movies: Movie[] }

/** Download behaviour. Every change is saved as soon as it is made. */
export function DownloadsSettings() {
  const [speed, setSpeed] = useState('0');
  const [concurrent, setConcurrent] = useState('2');
  const [autoDelete, setAutoDelete] = useState(false);
  const [autoSubs, setAutoSubs] = useState(true);
  const [subLang, setSubLang] = useState('en');

  useEffect(() => {
    Promise.all(['downloadLimitKBps', 'maxConcurrentDownloads', 'autoDeleteWatched', 'autoSubtitles', 'subtitleLanguage'].map(k => window.electronAPI.settings.get(k)))
      .then(([sp, mc, ad, as, sl]) => {
        setSpeed(sp || '0'); setConcurrent(mc || '2'); setAutoDelete(ad === 'true'); setAutoSubs(as !== 'false'); setSubLang(sl || 'en');
      });
  }, []);

  return (
    <div className="settings-section">
      <div className="settings-section-title">Downloads</div>
      <SettingRow title="Speed limit" hint="Applies to downloads only. Streaming always runs at full speed.">
        <select className="settings-input" value={speed} onChange={e => { setSpeed(e.target.value); set('downloadLimitKBps', e.target.value); }}>
          {SPEEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </SettingRow>
      <SettingRow title="Downloads at the same time" hint="Extra downloads wait in the queue and start automatically.">
        <select className="settings-input" value={concurrent} onChange={e => { setConcurrent(e.target.value); set('maxConcurrentDownloads', e.target.value); }}>
          {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </SettingRow>
      <SettingRow title="Save subtitles with downloads" hint="Fetches a matching subtitle file and keeps it next to the movie.">
        <Toggle on={autoSubs} onChange={v => { setAutoSubs(v); set('autoSubtitles', String(v)); }} />
      </SettingRow>
      {autoSubs && (
        <SettingRow title="Subtitle language">
          <select className="settings-input" value={subLang} onChange={e => { setSubLang(e.target.value); set('subtitleLanguage', e.target.value); }}>
            {SUB_LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </SettingRow>
      )}
      <SettingRow title="Delete downloads after watching" hint="Only movies and episodes this app downloaded, once watched to the end. They go to the Recycle Bin.">
        <Toggle on={autoDelete} onChange={v => { setAutoDelete(v); set('autoDeleteWatched', String(v)); }} />
      </SettingRow>
    </div>
  );
}

/** Clean-up tools for the local library. */
export function LibraryTools({ onLibraryChanged }: { onLibraryChanged: () => void }) {
  const { showToast } = useToast();
  const [dups, setDups] = useState<DupGroup[] | null>(null);
  const [busy, setBusy] = useState(false);

  const findDuplicates = async () => {
    setBusy(true);
    try {
      const all = await window.electronAPI.movies.getAll();
      const groups = new Map<string, Movie[]>();
      for (const m of all) {
        const key = `${normTitle(m.title)}|${m.year ?? ''}`;
        if (normTitle(m.title).length < 2) continue;
        groups.set(key, [...(groups.get(key) ?? []), m]);
      }
      setDups([...groups.entries()].filter(([, v]) => v.length > 1).map(([key, movies]) => ({ key, movies })));
    } finally { setBusy(false); }
  };

  const dropRecord = async (m: Movie) => {
    await window.electronAPI.movies.delete(m.id);
    setDups(d => d && d.map(g => ({ ...g, movies: g.movies.filter(x => x.id !== m.id) })).filter(g => g.movies.length > 1));
    onLibraryChanged();
  };
  const trashFile = async (m: Movie) => {
    if (!window.confirm(`Move "${m.fileName}" to the Recycle Bin?`)) return;
    try {
      await window.electronAPI.library.trash?.(m.id);
      setDups(d => d && d.map(g => ({ ...g, movies: g.movies.filter(x => x.id !== m.id) })).filter(g => g.movies.length > 1));
      onLibraryChanged();
      showToast('Moved to the Recycle Bin', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not delete the file', 'error');
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-title">Library tools</div>
      <SettingRow title="Duplicates" hint="Finds movies that appear more than once, for example two qualities of the same film.">
        <button className="btn btn-secondary btn-sm" onClick={findDuplicates} disabled={busy}>{busy ? 'Looking...' : 'Find duplicates'}</button>
      </SettingRow>
      {dups && dups.length === 0 && <p className="setting-row-hint" style={{ color: '#46d369', padding: '4px 0 8px' }}><Icon name="check" size={14} /> No duplicates found.</p>}
      {dups?.map(g => (
        <div key={g.key} className="dup-group">
          <div className="dup-title">{g.movies[0].title}{g.movies[0].year ? ` (${g.movies[0].year})` : ''}</div>
          {g.movies.map(m => (
            <div key={m.id} className="dup-file">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="dup-name">{m.fileName}</div>
                <div className="setting-row-hint">{formatBytes(m.fileSize)} · {m.filePath}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => dropRecord(m)} title="Keep the file, hide it from the library">Hide</button>
              {window.electronAPI.library.trash && <button className="btn btn-ghost btn-sm" onClick={() => trashFile(m)} title="Move the file to the Recycle Bin"><Icon name="trash" size={14} /> Delete file</button>}
            </div>
          ))}
        </div>
      ))}
      <SettingRow title="Wrong poster or details?" hint="Open the movie and choose Fix match. &quot;Hide&quot; above only removes an entry until the next scan." />
    </div>
  );
}
