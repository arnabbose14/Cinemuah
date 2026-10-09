import React, { useState, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import type { AppMode } from '@/types';
import { useProfile } from '@/contexts/ProfileContext';
import { Avatar } from './ProfilePicker';

type Page = 'home' | 'movies' | 'genres' | 'discover' | 'series' | 'downloads' | 'playlists' | 'search' | 'continue' | 'mylist' | 'settings';

interface NavbarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  onSearch: (query: string) => void;
  movieCount: number;
  downloadCount?: number;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

export function Navbar({ currentPage, onNavigate, onSearch, movieCount, downloadCount = 0, mode, onModeChange }: NavbarProps) {
  const { supported: profilesOn, active: profile, profiles, openPicker } = useProfile();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Search suggestions while typing, and recent searches when the box is empty
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<{ label: string; sub: string }[]>([]);
  const [recents, setRecents] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('cm_recent_searches') || '[]'); } catch { return []; } });
  const remember = (q: string) => {
    const v = q.trim();
    if (v.length < 2) return;
    const next = [v, ...recents.filter(r => r.toLowerCase() !== v.toLowerCase())].slice(0, 8);
    setRecents(next);
    localStorage.setItem('cm_recent_searches', JSON.stringify(next));
  };
  const forget = (q: string) => {
    const next = recents.filter(r => r !== q);
    setRecents(next);
    localStorage.setItem('cm_recent_searches', JSON.stringify(next));
  };
  const pick = (q: string) => { setSearchQuery(q); onSearch(q); remember(q); setFocused(false); if (currentPage !== 'search') onNavigate('search'); };

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (mode === 'online') {
          // Movie matches show the moment they arrive; series (a slower source) join in when ready
          let movieItems: { label: string; sub: string }[] = [];
          let showItems: { label: string; sub: string }[] = [];
          const publish = () => { if (!cancelled) setSuggestions([...movieItems, ...showItems]); };
          await Promise.all([
            window.electronAPI.yts.list({ query: q, limit: 6, page: 1 }).then(r => { movieItems = r.movies.slice(0, 5).map(m => ({ label: m.title, sub: `Movie \u00b7 ${m.year}` })); publish(); }).catch(() => {}),
            window.electronAPI.series.list({ query: q }).then(r => { showItems = r.shows.slice(0, 3).map(s => ({ label: s.title, sub: `Series${s.year ? ' \u00b7 ' + s.year : ''}` })); publish(); }).catch(() => {}),
          ]);
        } else {
          const found = await window.electronAPI.movies.search(q);
          if (!cancelled) setSuggestions(found.slice(0, 6).map(m => ({ label: m.title, sub: m.year ? `Movie \u00b7 ${m.year}` : 'Movie' })));
        }
      } catch { if (!cancelled) setSuggestions([]); }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery, mode]);

  useEffect(() => {
    const mainEl = document.querySelector('.main-content');
    if (!mainEl) return;
    const handleScroll = () => setScrolled(mainEl.scrollTop > 20);
    mainEl.addEventListener('scroll', handleScroll);
    return () => mainEl.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearchQuery(q);
    onSearch(q);
    if (q && currentPage !== 'search') {
      onNavigate('search');
    }
  };

  const handleSearchFocus = () => {
    setFocused(true);
    if (currentPage !== 'search') {
      onNavigate('search');
    }
  };

  // Offline mode browses the local library; online mode browses the web catalogue.
  const base: { page: Page; label: string }[] = mode === 'online'
    ? [
        { page: 'home', label: 'Home' },
        { page: 'discover', label: 'Movies' },
        { page: 'series', label: 'Series' },
      ]
    : [
        { page: 'home', label: 'Home' },
        { page: 'movies', label: 'Movies' },
        { page: 'genres', label: 'Genres' },
        { page: 'continue', label: 'Continue Watching' },
        { page: 'mylist', label: 'My List' },
      ];
  const links = window.electronAPI.playlists ? [...base, { page: 'playlists' as Page, label: 'Playlists' }] : base;

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
      {!scrolled && <div className="navbar-gradient" />}
      {/* The only window-drag area. It stops short of the corner so the window buttons are never covered by it */}
      <div className="navbar-drag" />

      {/* Logo */}
      <div className="navbar-logo" onClick={() => onNavigate('home')} style={{ cursor: 'pointer' }}>
        <img src="./logo.png" alt="Cinemuah" className="navbar-logo-img" draggable={false} />
      </div>

      {/* Nav links */}
      {/* Narrow windows: the links collapse into one menu so nothing is cut off */}
      <div className="nav-compact">
        <button className="nav-link active" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}>
          {links.find(l => l.page === currentPage)?.label ?? 'Menu'} <Icon name="chevronRight" size={14} style={{ transform: menuOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </button>
        {menuOpen && (
          <>
            <div className="nav-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="nav-menu">
              {links.map(link => (
                <button key={link.page} className={`nav-menu-item ${currentPage === link.page ? 'active' : ''}`} onClick={() => { setMenuOpen(false); onNavigate(link.page); }}>
                  {link.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="navbar-nav">
        {links.map(link => (
          <button
            key={link.page}
            className={`nav-link ${currentPage === link.page ? 'active' : ''}`}
            onClick={() => onNavigate(link.page)}
          >
            {link.label}
          </button>
        ))}
      </div>

      {/* Right side */}
      <div className="navbar-right">
        {/* Online / Offline switch */}
        <div className="mode-switch" role="group" aria-label="Library source">
          <button
            className={`mode-switch-btn ${mode === 'offline' ? 'active' : ''}`}
            onClick={() => onModeChange('offline')}
            title="Offline: show only your local library"
          >
            <Icon name="folder" size={14} /> Offline
          </button>
          <button
            className={`mode-switch-btn ${mode === 'online' ? 'active' : ''}`}
            onClick={() => onModeChange('online')}
            title="Online: browse and stream movies and series"
          >
            <Icon name="cloud" size={14} /> Online
          </button>
        </div>

        {/* Search */}
        <div className="search-container">
          <div className="search-box">
            <span style={{ color: 'var(--text-muted)', fontSize: 18, display: 'flex' }}><Icon name="search" /></span>
            <input
              ref={searchRef}
              className="search-input"
              type="text"
              placeholder={mode === 'online' ? 'Search movies and series...' : 'Search movies...'}
              value={searchQuery}
              onChange={handleSearch}
              onFocus={handleSearchFocus}
              onBlur={() => { remember(searchQuery); setTimeout(() => setFocused(false), 150); }}
              onKeyDown={e => { if (e.key === 'Enter') { remember(searchQuery); setFocused(false); searchRef.current?.blur(); } }}
            />
            {searchQuery && (
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}
                onClick={() => { setSearchQuery(''); onSearch(''); }}
              >
                <Icon name="close" size={16} />
              </button>
            )}
          </div>
        {focused && (searchQuery.trim().length < 2 ? recents.length > 0 : suggestions.length > 0) && (
          <div className="search-suggest" >
            {searchQuery.trim().length < 2 ? (
              <>
                <div className="search-suggest-head">Recent searches</div>
                {recents.map(r => (
                  <div key={r} className="search-suggest-row" onMouseDown={e => { e.preventDefault(); pick(r); }}>
                    <Icon name="search" size={14} /><span className="search-suggest-label">{r}</span>
                    <button className="search-suggest-x" title="Remove" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); forget(r); }}><Icon name="close" size={12} /></button>
                  </div>
                ))}
              </>
            ) : suggestions.map((s, i) => (
              <div key={i} className="search-suggest-row" onMouseDown={e => { e.preventDefault(); pick(s.label); }}>
                <Icon name="search" size={14} /><span className="search-suggest-label">{s.label}</span><span className="search-suggest-sub">{s.sub}</span>
              </div>
            ))}
          </div>
        )}

        </div>

        {/* Library count */}
        {mode === 'offline' && movieCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {movieCount} movies
          </span>
        )}

        {/* Downloads */}
        <button
          className="icon-btn"
          onClick={() => onNavigate('downloads')}
          title="Downloads"
          style={{ position: 'relative', color: currentPage === 'downloads' ? 'var(--text-primary)' : undefined }}
        >
          <Icon name="download" size={22} />
          {downloadCount > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 0, minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{downloadCount}</span>
          )}
        </button>

        {/* Profile */}
        {profilesOn && profile && (
          <button className="icon-btn" onClick={() => openPicker()} title={profiles.length > 1 ? `${profile.name} Â· switch profile` : `${profile.name} Â· manage profiles`} style={{ padding: 2 }}>
            <Avatar profile={profile} size={30} />
          </button>
        )}

        {/* Settings */}
        {!profile?.kids && <button
          className={`icon-btn ${currentPage === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
          title="Settings"
          style={{ color: currentPage === 'settings' ? 'var(--text-primary)' : undefined }}
        >
          <Icon name="settings" size={22} />
        </button>}

      </div>
    </nav>
  );
}
