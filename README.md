# CineLocal - Personal Netflix-Style Movie Streaming App

A sleek, desktop-grade Netflix-inspired streaming application built with **Electron**, **React**, **TypeScript**, **Vite**, and **SQLite**, designed to stream local video collections directly from Windows storage (e.g. `E:\Personal\Movies`).

---

## Features

- **Direct Local Streaming**: Serves files via an integrated Node.js HTTP media server with full **HTTP 206 Range Request** support for instant, butter-smooth timeline scrubbing/seeking.
- **Robust Path Security**: Validates directory boundaries to prevent path traversal, ensuring only media within the designated library folder is accessible.
- **Recursive Library Scanner**: Recursively scans folders (supports subfolders, e.g., `E:\Personal\Movies\Action\Movie.mkv`) for `.mp4`, `.mkv`, `.avi`, `.mov`, `.webm`, `.m4v`.
- **Smart Title & Year Parser**: Automatically extracts clean movie titles and release years from common scene and standard release filenames (`Title (2020)`, `Title.2020.mkv`, etc.).
- **Metadata Integration**: Seamless TMDB API integration for posters, backdrops, ratings, overviews, cast, directors, writers, and genres.
- **Manual Metadata Editor**: Easily tweak or correct titles, years, synopses, posters, backdrops, or search TMDB interactively.
- **Resume Playback & Progress**: Tracks exact timestamps down to the second, updating dynamically every 5 seconds. Shows progress percentage and remaining time on Continue Watching cards.
- **Movies (Torrent Streaming)**: Browse/search the online catalogue, pick a quality, and stream instantly via WebTorrent through the same range-capable media server. Downloads go to a temp folder and are deleted when you close the player. If the movie source is blocked on your network, set a custom mirror from the Discover page's error screen.
- **My List & Favorites**: Bookmark movies with one click.
- **Fast Full-Text Search**: Instant search across titles, synopses, genres, directors, and cast members.
- **Dynamic Genre Discovery**: Automatically maps genres from your library into cinematic category rows and genre browse tiles.
- **Full-Featured Video Player**:
  - Play / Pause (Space / `K`)
  - Seeking with real-time scrub bar and ±10s skips (`←` / `→`)
  - Volume control with mute toggle (`M`, `↑` / `↓`)
  - Playback speed options (0.25x – 2x)
  - Fullscreen mode (`F`)
  - Picture-in-Picture (PiP)
  - Auto-hiding cursor & controls during active playback

---

## Project Structure

```text
Netflix/
├── electron/
│   ├── main.ts              # Electron lifecycle, window creation, IPC handlers
│   ├── preload.ts           # Secure contextBridge API bindings
│   ├── database.ts          # SQLite DB setup & FTS5 full-text search triggers
│   ├── movie-store.ts       # Database queries, updates, sorting, and progress
│   ├── media-server.ts      # HTTP streaming server with Byte-Range support
│   ├── scanner.ts           # Recursive file scanner & filename parser
│   └── metadata-service.ts  # TMDB API client (search, credits, details)
├── src/
│   ├── components/
│   │   ├── Navbar.tsx       # Top navigation & search input
│   │   ├── Hero.tsx         # Netflix-style cinematic hero banner
│   │   ├── MovieCard.tsx    # Interactive movie card with hover actions & progress
│   │   ├── MovieRow.tsx     # Horizontally scrolling carousel rows
│   │   ├── MovieDetail.tsx  # Full modal overview, cast/crew, and similar movies
│   │   ├── VideoPlayer.tsx  # Custom HTML5 streaming player
│   │   ├── EditMovie.tsx    # Manual metadata editor & TMDB query dialog
│   │   └── LazyImage.tsx    # Lazy loading with skeleton/placeholders
│   ├── pages/
│   │   ├── HomePage.tsx     # Hero banner + categorized rows
│   │   ├── MoviesPage.tsx   # All movies grid with custom sorting
│   │   ├── GenresPage.tsx   # Dynamic genre tile explorer
│   │   ├── SearchPage.tsx   # Search results grid
│   │   ├── ContinueWatchingPage.tsx # In-progress movies
│   │   ├── MyListPage.tsx   # Bookmarked collection
│   │   └── SettingsPage.tsx # Folder picker, TMDB API key, scanner, and themes
│   ├── contexts/            # React context providers (Media, Toast notifications)
│   ├── styles/globals.css   # Dark cinematic styling & micro-animations
│   ├── types/               # TypeScript interfaces
│   ├── App.tsx              # Root component & navigation router
│   └── main.tsx             # React DOM entrypoint
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **Windows OS**: Windows 10/11 (or macOS / Linux)

---

## Setup & Running

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run in Development Mode**:
   ```bash
   npm run dev
   ```
   *This starts the Vite React dev server on `http://localhost:5173` and launches the Electron desktop application.*

3. **Build Production Application**:
   ```bash
   npm run build
   ```
   To generate Windows installer/executable (`.exe`):
   ```bash
   npm run build:electron
   ```

---

## Initial Configuration

1. Launch the application.
2. Navigate to **Settings** (gear icon in the top right).
3. The default library folder is configured to `E:\Personal\Movies`. You can click **Change** to select any other directory on your PC.
4. (Optional) Provide a free **TMDB API Key** under **Metadata (TMDB)** to enable automatic poster, backdrop, and cast downloading.
5. Click **Scan Library** to index your files.
