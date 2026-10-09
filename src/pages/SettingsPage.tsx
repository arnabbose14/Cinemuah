import React, { useState, useEffect } from 'react';
import { LANGUAGES, parseLanguages, setLanguagesCache } from '@/lib/languages';
import type { ScanProgress, ScanResult } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import { useProfile } from '@/contexts/ProfileContext';
import { Icon, type IconName } from '@/components/Icon';
import { Avatar } from '@/components/ProfilePicker';
import { DownloadsSettings, LibraryTools, SettingRow, Toggle } from '@/components/SettingsExtras';

interface SettingsPageProps {
  onScanComplete: () => void;
}

type Tab = 'library' | 'playback' | 'downloads' | 'content' | 'profiles' | 'about';

const TABS: { id: Tab; label: string; icon: IconName; blurb: string }[] = [
  { id: 'library', label: 'Library', icon: 'folder', blurb: 'Your movie folder, scanning and artwork' },
  { id: 'playback', label: 'Playback', icon: 'play', blurb: 'How the player behaves and looks' },
  { id: 'downloads', label: 'Downloads', icon: 'download', blurb: 'Speed, queue and subtitles' },
  { id: 'content', label: 'Content', icon: 'cloud', blurb: 'Languages and the online movie source' },
  { id: 'profiles', label: 'Profiles', icon: 'user', blurb: 'Who watches, PINs and kids profiles' },
  { id: 'about', label: 'About', icon: 'info', blurb: 'Version and supported formats' },
];

export function SettingsPage({ onScanComplete }: SettingsPageProps) {
  const { showToast } = useToast();
  const { supported: profilesOn, profiles, active, openPicker } = useProfile();
  const [tab, setTab] = useState<Tab>('library');
  const [moviesFolder, setMoviesFolder] = useState('E:\\Personal\\Movies');
  const [tmdbApiKey, setTmdbApiKey] = useState('');
  const [autoResume, setAutoResume] = useState(true);
  const [defaultSpeed, setDefaultSpeed] = useState('1');
  const [rememberVolume, setRememberVolume] = useState(true);
  const [accentColor, setAccentColor] = useState('#e50914');
  const [languages, setLanguages] = useState<string[]>([]);
  const [ytsMirror, setYtsMirror] = useState('');
  const [ytsTesting, setYtsTesting] = useState(false);
  const [ytsStatus, setYtsStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Load settings
  useEffect(() => {
    Promise.all([
      window.electronAPI.settings.get('moviesFolder'),
      window.electronAPI.settings.get('tmdbApiKey'),
      window.electronAPI.settings.get('autoResume'),
      window.electronAPI.settings.get('defaultSpeed'),
      window.electronAPI.settings.get('rememberVolume'),
      window.electronAPI.settings.get('accentColor'),
      window.electronAPI.settings.get('ytsMirror'),
      window.electronAPI.settings.get('languages'),
    ]).then(([folder, key, resume, speed, vol, color, mirror, langs]) => {
      setLanguages(parseLanguages(langs));
      if (mirror) setYtsMirror(mirror);
      if (folder) setMoviesFolder(folder);
      if (key) setTmdbApiKey(key);
      if (resume) setAutoResume(resume === 'true');
      if (speed) setDefaultSpeed(speed);
      if (vol) setRememberVolume(vol === 'true');
      if (color) setAccentColor(color);
    });
  }, []);

  const saveSettings = async () => {
    await Promise.all([
      window.electronAPI.settings.set('moviesFolder', moviesFolder),
      window.electronAPI.settings.set('tmdbApiKey', tmdbApiKey),
      window.electronAPI.settings.set('autoResume', String(autoResume)),
      window.electronAPI.settings.set('defaultSpeed', defaultSpeed),
      window.electronAPI.settings.set('rememberVolume', String(rememberVolume)),
      window.electronAPI.settings.set('accentColor', accentColor),
      window.electronAPI.settings.set('ytsMirror', ytsMirror.trim()),
      window.electronAPI.settings.set('languages', languages.join(',')),
    ]);
    setLanguagesCache(languages);
    document.documentElement.style.setProperty('--accent', accentColor);
    showToast('Settings saved!', 'success');
  };

  const selectFolder = async () => {
    const folder = await window.electronAPI.dialog.selectFolder();
    if (folder) {
      setMoviesFolder(folder);
      await window.electronAPI.settings.set('moviesFolder', folder);
      showToast('Folder updated!', 'success');
    }
  };

  const startScan = async () => {
    setScanning(true);
    setScanProgress(null);
    setScanResult(null);
    setScanError(null);

    window.electronAPI.library.onScanProgress(progress => setScanProgress(progress));
    window.electronAPI.library.onScanComplete(result => {
      setScanResult(result as ScanResult);
      setScanning(false);
      onScanComplete();
      window.electronAPI.library.removeScanListeners();
    });
    window.electronAPI.library.onScanError(error => {
      setScanError(error.message);
      setScanning(false);
      window.electronAPI.library.removeScanListeners();
    });

    try {
      await window.electronAPI.library.scan(moviesFolder);
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
      setScanning(false);
    }
  };

  const progressPercent = scanProgress && scanProgress.total > 0
    ? Math.round((scanProgress.current / scanProgress.total) * 100)
    : 0;

  // Download tuning (speed, queue, auto-delete) and library clean-up tools are desktop features
  const desktop = document.documentElement.classList.contains('is-desktop');
  const tabs = TABS.filter(t => (t.id !== 'profiles' || profilesOn) && (t.id !== 'downloads' || desktop));
  const current = tabs.find(t => t.id === tab) ?? tabs[0];

  return (
    <div className="settings-layout">
      <aside className="settings-nav">
        <h1 className="settings-title">Settings</h1>
        {tabs.map(t => (
          <button key={t.id} className={`settings-nav-item ${current.id === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={20} /> {t.label}
          </button>
        ))}
      </aside>

      <main className="settings-content">
        <div className="settings-head">
          <h2>{current.label}</h2>
          <p>{current.blurb}</p>
        </div>

        {current.id === 'library' && (
          <>
            <div className="settings-section">
              <div className="settings-section-title">Media library</div>
              <SettingRow title="Movie folder" hint="Cinemuah scans this folder and saves downloads into it." stacked>
                <div className="settings-path">
                  <div className="settings-path-value">{moviesFolder}</div>
                  <button className="btn btn-ghost btn-sm" onClick={selectFolder}><Icon name="folder" /> Change</button>
                </div>
              </SettingRow>
              <SettingRow title="Scan library" hint="Look for new, moved and removed movies.">
                <button className="btn btn-accent" onClick={startScan} disabled={scanning}>
                  {scanning ? 'Scanning...' : <><Icon name="refresh" /> Scan now</>}
                </button>
              </SettingRow>

              {scanning && scanProgress && (
                <div style={{ paddingTop: 8 }}>
                  <div className="scan-message">{scanProgress.message}</div>
                  <div className="scan-progress-track"><div className="scan-progress-fill" style={{ width: `${progressPercent}%` }} /></div>
                  <div className="scan-progress-text">{scanProgress.current} / {scanProgress.total} · {progressPercent}%</div>
                </div>
              )}

              {scanResult && (
                <div style={{ paddingTop: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--success)' }}><Icon name="check" /> Scan complete</div>
                  <div className="scan-stats">
                    <div className="scan-stat"><div className="scan-stat-value">{scanResult.totalFiles}</div><div className="scan-stat-label">Total Files</div></div>
                    <div className="scan-stat"><div className="scan-stat-value">{scanResult.newMovies}</div><div className="scan-stat-label">New Movies</div></div>
                    <div className="scan-stat"><div className="scan-stat-value">{scanResult.removedMovies}</div><div className="scan-stat-label">Removed</div></div>
                    <div className="scan-stat"><div className="scan-stat-value">{scanResult.failedMovies}</div><div className="scan-stat-label">Need Attention</div></div>
                  </div>
                </div>
              )}

              {scanError && <div style={{ color: 'var(--accent)', fontSize: 14, marginTop: 8 }}><Icon name="warning" size={14} /> Error: {scanError}</div>}
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Artwork and details (TMDB)</div>
              <SettingRow
                stacked
                title="TMDB API key"
                hint={<>Needed for posters, backdrops, cast and ratings of your own files. <a className="settings-link" onClick={() => window.electronAPI.shell.openExternal('https://www.themoviedb.org/settings/api')}>Get a free key</a></>}
              >
                <input className="settings-input" type="password" placeholder="Enter your TMDB API key..." value={tmdbApiKey} onChange={e => setTmdbApiKey(e.target.value)} />
              </SettingRow>
            </div>

            {desktop && <LibraryTools onLibraryChanged={onScanComplete} />}
          </>
        )}

        {current.id === 'playback' && (
          <>
            <div className="settings-section">
              <div className="settings-section-title">Player</div>
              <SettingRow title="Auto resume" hint="Continue from where you left off.">
                <Toggle on={autoResume} onChange={setAutoResume} />
              </SettingRow>
              <SettingRow title="Remember volume">
                <Toggle on={rememberVolume} onChange={setRememberVolume} />
              </SettingRow>
              <SettingRow title="Default playback speed">
                <select className="settings-input" value={defaultSpeed} onChange={e => setDefaultSpeed(e.target.value)}>
                  <option value="0.5">0.5×</option>
                  <option value="0.75">0.75×</option>
                  <option value="1">1× (Normal)</option>
                  <option value="1.25">1.25×</option>
                  <option value="1.5">1.5×</option>
                  <option value="2">2×</option>
                </select>
              </SettingRow>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Appearance</div>
              <SettingRow title="Accent colour" hint="Buttons, progress bars and highlights.">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <input type="color" value={accentColor} onChange={e => setAccentColor(e.target.value)} className="color-input" />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{accentColor}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAccentColor('#e50914')}>Reset</button>
                </div>
              </SettingRow>
            </div>
          </>
        )}

        {current.id === 'downloads' && <DownloadsSettings />}

        {current.id === 'content' && (
          <>
            <div className="settings-section">
              <div className="settings-section-title">Movie languages</div>
              <SettingRow
                stacked
                title="Languages you want to watch"
                hint="Online movies are filtered to the languages you pick. Select none to see every language. Your local library is not affected."
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button className={`lang-chip ${languages.length === 0 ? 'active' : ''}`} onClick={() => setLanguages([])}>All languages</button>
                  {LANGUAGES.map(l => {
                    const on = languages.includes(l.code);
                    return (
                      <button key={l.code} className={`lang-chip ${on ? 'active' : ''}`} onClick={() => setLanguages(prev => on ? prev.filter(c => c !== l.code) : [...prev, l.code])}>
                        {on && <Icon name="check" size={14} />} {l.label}
                      </button>
                    );
                  })}
                </div>
              </SettingRow>
            </div>

            <div className="settings-section">
              <div className="settings-section-title">Movie source connection</div>
              <SettingRow
                stacked
                title="Custom API mirror (optional)"
                hint="Leave empty to use the built-in mirrors. If the movie source is blocked on your network, enter a working mirror URL."
              >
                <input className="settings-input" type="text" placeholder="https://movies-api.accel.li" value={ytsMirror} onChange={e => setYtsMirror(e.target.value)} />
              </SettingRow>
              <SettingRow title="Test connection" hint={ytsStatus ? (
                <span style={{ color: ytsStatus.ok ? '#46d369' : 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Icon name={ytsStatus.ok ? 'check' : 'warning'} size={14} /> {ytsStatus.text}
                </span>
              ) : 'Checks that the movie source can be reached.'}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={ytsTesting}
                  onClick={async () => {
                    setYtsTesting(true);
                    setYtsStatus(null);
                    try {
                      await window.electronAPI.settings.set('ytsMirror', ytsMirror.trim());
                      const r = await window.electronAPI.yts.test();
                      setYtsStatus(r.ok
                        ? { ok: true, text: `Connected to ${new URL(r.host!).hostname} (${r.ms} ms)` }
                        : { ok: false, text: r.error || 'Connection failed' });
                    } catch (err) {
                      setYtsStatus({ ok: false, text: err instanceof Error ? err.message : 'Connection failed' });
                    } finally {
                      setYtsTesting(false);
                    }
                  }}
                >
                  {ytsTesting ? 'Testing...' : <><Icon name="link" /> Test connection</>}
                </button>
              </SettingRow>
            </div>
          </>
        )}

        {current.id === 'profiles' && (
          <div className="settings-section">
            <div className="settings-section-title">Profiles</div>
            <SettingRow title="Who watches" hint="Each profile has its own history, playlists, My List and followed shows.">
              <button className="btn btn-secondary btn-sm" onClick={() => openPicker(true)}>Manage profiles</button>
            </SettingRow>
            <div className="settings-profiles">
              {profiles.map(p => (
                <div key={p.id} className="settings-profile">
                  <Avatar profile={p} size={56} />
                  <div className="settings-profile-name">{p.name}</div>
                  <div className="settings-profile-meta">
                    {[p.id === active?.id ? 'Current' : '', p.kids ? 'Kids' : '', p.hasPin ? 'PIN' : ''].filter(Boolean).join(' · ') || ' '}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {current.id === 'about' && (
          <div className="settings-section">
            <div className="settings-section-title">About</div>
            <SettingRow title="Cinemuah" hint="Personal movie streaming: your own library plus online movies and series." />
            <SettingRow title="Video formats" hint="MP4, MKV, AVI, MOV, WebM and M4V. Files a browser can't play are converted on the fly." />
            <SettingRow title="MKV and codecs" hint="Some unusual codecs may need conversion, which can take a moment to start." />
          </div>
        )}

        {(current.id === 'library' || current.id === 'playback' || current.id === 'content') && (
          <div className="settings-savebar">
            <span>Changes on this page are saved when you press Save. Downloads and Profiles apply instantly.</span>
            <button className="btn btn-accent" onClick={saveSettings}>Save settings</button>
          </div>
        )}
      </main>
    </div>
  );
}
