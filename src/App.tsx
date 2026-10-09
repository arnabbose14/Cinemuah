import React, { useState, useEffect, useCallback } from 'react';
import type { Movie, AppMode } from '@/types';
import { Navbar } from '@/components/Navbar';
import { HomePage } from '@/pages/HomePage';
import { MoviesPage } from '@/pages/MoviesPage';
import { SearchPage } from '@/pages/SearchPage';
import { GenresPage } from '@/pages/GenresPage';
import { ContinueWatchingPage } from '@/pages/ContinueWatchingPage';
import { MyListPage } from '@/pages/MyListPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { DiscoverPage } from '@/pages/DiscoverPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SeriesPage } from '@/pages/SeriesPage';
import { PlaylistsPage } from '@/pages/PlaylistsPage';
import { OnlineSearchPage } from '@/pages/OnlineSearchPage';
import { MovieDetail } from '@/components/MovieDetail';
import { VideoPlayer } from '@/components/VideoPlayer';
import { EditMovie } from '@/components/EditMovie';
import { useToast } from '@/contexts/ToastContext';
import { useProfile } from '@/contexts/ProfileContext';
import { ProfilePicker } from '@/components/ProfilePicker';
import { WindowControls } from '@/components/WindowControls';
import { isKidsMode, kidsAllowed } from '@/lib/kids';
import { parseMovieGenres } from '@/types';

type Page = 'home' | 'movies' | 'genres' | 'discover' | 'series' | 'downloads' | 'playlists' | 'search' | 'continue' | 'mylist' | 'settings';

export function App() {
  const { showToast } = useToast();
  const { version: profileVersion } = useProfile();

  // State
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [continueWatching, setContinueWatching] = useState<Movie[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<Movie[]>([]);
  const [myList, setMyList] = useState<Movie[]>([]);
  const [genres, setGenres] = useState<string[]>([]);
  const [movieCount, setMovieCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Movie[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [genreMovies, setGenreMovies] = useState<Movie[]>([]);
  const [onlineGenre, setOnlineGenre] = useState('all');

  // UI state
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [playingMovie, setPlayingMovie] = useState<Movie | null>(null);
  const [playStartPosition, setPlayStartPosition] = useState(0);
  const [editingMovie, setEditingMovie] = useState<Movie | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloadCount, setDownloadCount] = useState(0);
  const [mode, setMode] = useState<AppMode>(() => (localStorage.getItem('cinelocal_mode') === 'offline' ? 'offline' : 'online'));

  // Load all data
  const loadData = useCallback(async () => {
    try {
      const [
        allMovies,
        cw,
        recent,
        ml,
        g,
        count,
      ] = await Promise.all([
        window.electronAPI.movies.getAll({ sortBy: 'dateAdded', order: 'desc' }),
        window.electronAPI.movies.getContinueWatching(),
        window.electronAPI.movies.getRecentlyAdded(),
        window.electronAPI.movies.getMyList(),
        window.electronAPI.movies.getGenres(),
        window.electronAPI.movies.getCount(),
      ]);

      // Kids profiles only see family-friendly titles from the library too
      const allowed = (list: Movie[]) => (isKidsMode() ? list.filter(m => kidsAllowed(parseMovieGenres(m.genres))) : list);
      setMovies(allowed(allMovies));
      setContinueWatching(allowed(cw));
      setRecentlyAdded(allowed(recent));
      setMyList(allowed(ml));
      setGenres(g);
      setMovieCount(count);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Accent colour is a saved setting: apply it at launch, not only when Settings is saved
  useEffect(() => {
    window.electronAPI.settings.get('accentColor').then(c => { if (/^#[0-9a-f]{6}$/i.test(c || '')) document.documentElement.style.setProperty('--accent', c); }).catch(() => undefined);
  }, []);

  // Initial load + auto-scan
  useEffect(() => {
    loadData().then(async () => {
      // Auto-scan on startup (non-blocking)
      try {
        const folder = await window.electronAPI.settings.get('moviesFolder');
        if (folder) {
          window.electronAPI.library.scan(folder).then(() => {
            loadData();
          }).catch(console.error);
        }
      } catch (err) {
        console.error('Auto-scan failed:', err);
      }
    });
  }, [loadData]);

  // Active-download badge + refresh the library when a download lands in it
  useEffect(() => {
    const poll = () => window.electronAPI.downloads.list()
      .then(list => setDownloadCount(list.filter(d => d.status !== 'done' && d.status !== 'error').length))
      .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 3000);
    const off = window.electronAPI.downloads.onFinished(info => {
      showToast(`${info.title} finished downloading and was added to your library`, 'success');
      loadData();
      poll();
    });
    return () => { clearInterval(timer); off(); };
  }, [loadData, showToast]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const debounce = setTimeout(async () => {
      try {
        const results = await window.electronAPI.movies.search(searchQuery);
        setSearchResults(results);
      } catch (err) {
        console.error('Search failed:', err);
      }
    }, 200);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  // Load genre movies
  useEffect(() => {
    if (!selectedGenre) return;
    window.electronAPI.movies.getByGenre(selectedGenre).then(setGenreMovies);
  }, [selectedGenre]);

  const handlePlay = useCallback(async (movie: Movie, startPosition?: number) => {
    // "Auto resume" off: a plain Play starts from the beginning (the Resume buttons pass a position)
    let start = startPosition || (movie.position || 0);
    if (startPosition === undefined) {
      try { if ((await window.electronAPI.settings.get('autoResume')) === 'false') start = 0; } catch { /* keep default */ }
    }
    setPlayingMovie(movie);
    setPlayStartPosition(start);
    setSelectedMovie(null);
  }, []);

  const handleClosePlayer = useCallback(async () => {
    const closing = playingMovie;
    setPlayingMovie(null);
    // Optional tidy-up: downloads this app made are removed once watched (Settings > Downloads)
    if (closing) {
      try {
        const removed = await window.electronAPI.library.cleanupWatched?.(closing.id);
        if (removed) showToast(`Removed "${removed}" to the Recycle Bin because you finished it`, 'info');
      } catch { /* leave the file alone */ }
    }
    loadData(); // Refresh to update progress
  }, [loadData, playingMovie, showToast]);

  // A different profile has its own progress, My List and history
  useEffect(() => {
    if (profileVersion === 0) return;
    setCurrentPage('home');
    setSelectedMovie(null);
    setSearchQuery('');
    loadData();
  }, [profileVersion, loadData]);

  const handleProgressUpdate = useCallback(async (position: number, duration: number) => {
    if (!playingMovie) return;
    try {
      await window.electronAPI.progress.update(playingMovie.id, position, duration);
    } catch (err) {
      console.error('Failed to update progress:', err);
    }
  }, [playingMovie]);

  const handleToggleList = useCallback(async (movie: Movie) => {
    try {
      const isNowInList = await window.electronAPI.mylist.toggle(movie.id);
      showToast(isNowInList ? 'Added to My List' : 'Removed from My List', 'success');
      // keep an open details window in step (its button reads "In My List" from this object)
      setSelectedMovie(cur => (cur && cur.id === movie.id ? { ...cur, isInMyList: isNowInList ? 1 : 0 } : cur));
      loadData();
    } catch (err) {
      showToast('Failed to update list', 'error');
    }
  }, [loadData, showToast]);

  const handleModeChange = useCallback((next: AppMode) => {
    setMode(next);
    localStorage.setItem('cinelocal_mode', next);
    setSearchQuery('');
    setSelectedGenre(null);
    // Pages that only exist in the other mode fall back to Home
    const hiddenInNext: Page[] = next === 'offline' ? ['discover', 'series'] : ['movies', 'genres', 'continue', 'mylist'];
    setCurrentPage(p => (hiddenInNext.includes(p) || p === 'search') ? 'home' : p);
  }, []);

  const handleNavigate = useCallback((page: string) => {
    setCurrentPage(page as Page);
    setSelectedGenre(null);
    if (page === 'discover') setOnlineGenre('all');
    setSelectedMovie(null);
  }, [mode]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    // Online search results only make sense while there is a query
    if (!query.trim() && mode === 'online') setCurrentPage(p => (p === 'search' ? 'home' : p));
  }, [mode]);

  const handleSelectGenre = useCallback((genre: string) => {
    setSelectedGenre(genre);
    setCurrentPage('movies');
  }, []);

  const handleOnlineGenre = useCallback((genre: string) => {
    setOnlineGenre(genre);
    setCurrentPage('discover');
  }, []);

  const handleDetail = useCallback((movie: Movie) => {
    setSelectedMovie(movie);
  }, []);

  const handleEditSave = useCallback(async (updated: Partial<Movie>) => {
    if (!editingMovie) return;
    try {
      await window.electronAPI.movies.update(editingMovie.id, updated as Record<string, unknown>);
      setEditingMovie(null);
      await loadData();
      // If viewing detail, refresh selected movie
      if (selectedMovie?.id === editingMovie.id) {
        const fresh = await window.electronAPI.movies.getById(editingMovie.id);
        if (fresh) setSelectedMovie(fresh);
      }
    } catch (err) {
      showToast('Failed to save changes', 'error');
    }
  }, [editingMovie, selectedMovie, loadData, showToast]);

  const handleRefreshMetadata = useCallback(async (movie: Movie) => {
    try {
      showToast('Refreshing metadata...', 'info');
      const updated = await window.electronAPI.metadata.refreshMovie(movie.id);
      if (updated) {
        showToast('Metadata refreshed!', 'success');
        await loadData();
        if (selectedMovie?.id === movie.id) {
          setSelectedMovie(updated);
        }
      } else {
        showToast('Could not find metadata. Check TMDB API key in Settings.', 'error');
      }
    } catch {
      showToast('Metadata refresh failed', 'error');
    }
  }, [loadData, selectedMovie, showToast]);

  // Render active page
  const renderPage = () => {
    if (loading) {
      return (
        <div className="empty-state" style={{ paddingTop: 200 }}>
          <div className="spinner" />
          <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Loading your library...</p>
        </div>
      );
    }

    if (currentPage === 'search' && mode === 'online') {
      return <OnlineSearchPage query={searchQuery} />;
    }

    if (currentPage === 'search') {
      return (
        <SearchPage
          query={searchQuery}
          movies={searchResults}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
        />
      );
    }

    if (currentPage === 'movies') {
      const displayMovies = selectedGenre ? genreMovies : movies;
      return (
        <MoviesPage
          movies={displayMovies}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
          genre={selectedGenre || undefined}
          genres={genres}
          onSelectGenre={setSelectedGenre}
          title={selectedGenre ? `${selectedGenre} Movies` : 'All Movies'}
        />
      );
    }

    if (currentPage === 'genres') {
      return (
        <GenresPage
          genres={genres}
          movies={movies}
          onSelectGenre={handleSelectGenre}
        />
      );
    }

    if (currentPage === 'discover') {
      return (
        <DiscoverPage genre={onlineGenre} onGenreChange={setOnlineGenre} />
      );
    }

    if (currentPage === 'series') {
      return <SeriesPage />;
    }

    if (currentPage === 'playlists') {
      return (
        <PlaylistsPage localMovies={movies} onPlay={handlePlay} onDetail={handleDetail} onToggleList={handleToggleList} />
      );
    }

    if (currentPage === 'downloads') {
      return <DownloadsPage />;
    }

    if (currentPage === 'continue') {
      return (
        <ContinueWatchingPage
          movies={continueWatching}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
        />
      );
    }

    if (currentPage === 'mylist') {
      return (
        <MyListPage
          movies={myList}
          onPlay={handlePlay}
          onDetail={handleDetail}
          onToggleList={handleToggleList}
        />
      );
    }

    if (currentPage === 'settings') {
      return (
        <SettingsPage onScanComplete={loadData} />
      );
    }

    // Home
    return (
      <HomePage
        mode={mode}
        movies={movies}
        continueWatching={continueWatching}
        recentlyAdded={recentlyAdded}
        genres={genres}
        onPlay={handlePlay}
        onDetail={handleDetail}
        onToggleList={handleToggleList}
        onNavigateGenre={handleSelectGenre}
        onNavigatePage={handleNavigate}
        onOnlineGenre={handleOnlineGenre}
      />
    );
  };

  return (
    <div className="app-container">
      <ProfilePicker />
      {/* Titlebar drag region */}
      <div className="titlebar" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Navbar */}
      {!playingMovie && (
        <Navbar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          onSearch={handleSearch}
          movieCount={movieCount}
          downloadCount={downloadCount}
          mode={mode}
          onModeChange={handleModeChange}
        />
      )}

      {/* Main content */}
      {!playingMovie && (
        <main className="main-content">
          {renderPage()}
        </main>
      )}

      {/* Video Player */}
      {playingMovie && (
        <VideoPlayer
          movie={playingMovie}
          startPosition={playStartPosition}
          subtitleContext={{ title: playingMovie.title, year: playingMovie.year ?? undefined, filePath: playingMovie.filePath }}
          onClose={handleClosePlayer}
          onProgressUpdate={handleProgressUpdate}
        />
      )}

      {/* Movie Detail Modal */}
      {selectedMovie && !playingMovie && (
        <MovieDetail
          movie={selectedMovie}
          allMovies={movies}
          onClose={() => setSelectedMovie(null)}
          onPlay={handlePlay}
          onToggleList={handleToggleList}
          onNavigate={handleDetail}
          onEdit={(m) => setEditingMovie(m)}
          onRefreshMetadata={handleRefreshMetadata}
          onMatchFixed={async m => { await loadData(); const fresh = await window.electronAPI.movies.getById(m.id); if (fresh) setSelectedMovie(fresh); }}
        />
      )}

      {/* Always last in the DOM: later elements win over drag areas, so these buttons stay clickable */}
      <WindowControls />

      {/* Edit Movie Modal */}
      {editingMovie && (
        <EditMovie
          movie={editingMovie}
          onSave={handleEditSave}
          onClose={() => setEditingMovie(null)}
          onRefreshMetadata={() => handleRefreshMetadata(editingMovie)}
        />
      )}
    </div>
  );
}
