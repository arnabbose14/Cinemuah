import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import mime from 'mime';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, '../cinelocal-web.sqlite');

let db: SqlJsDatabase;

function saveDb() {
  if (db && DB_FILE) {
    try {
      const data = db.export();
      fs.writeFileSync(DB_FILE, Buffer.from(data));
    } catch (err) {
      console.error('Failed to save db:', err);
    }
  }
}

async function initDb() {
  let wasmPath = '';
  try {
    const sqlModule = require.resolve('sql.js');
    wasmPath = path.join(path.dirname(sqlModule), 'sql-wasm.wasm');
  } catch {}

  const SQL = await initSqlJs({
    locateFile: () => wasmPath || path.join(__dirname, 'sql-wasm.wasm'),
  });

  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filePath TEXT UNIQUE NOT NULL,
      fileName TEXT NOT NULL,
      title TEXT NOT NULL,
      year INTEGER,
      description TEXT DEFAULT '',
      poster TEXT DEFAULT '',
      backdrop TEXT DEFAULT '',
      duration INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      director TEXT DEFAULT '',
      writers TEXT DEFAULT '[]',
      cast TEXT DEFAULT '[]',
      genres TEXT DEFAULT '[]',
      tmdbId INTEGER,
      dateAdded INTEGER DEFAULT (strftime('%s', 'now')),
      lastModified INTEGER DEFAULT (strftime('%s', 'now')),
      fileSize INTEGER DEFAULT 0,
      isInMyList INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movieId INTEGER NOT NULL,
      position REAL DEFAULT 0,
      duration REAL DEFAULT 0,
      lastPlayed INTEGER DEFAULT (strftime('%s', 'now')),
      watchCount INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      UNIQUE(movieId)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Default settings
  const check = db.prepare('SELECT value FROM settings WHERE key = ?');
  check.bind(['moviesFolder']);
  if (!check.step()) {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['moviesFolder', 'E:\\Personal\\Movies']);
  }
  check.free();
  saveDb();
}

function queryAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql: string, params: any[] = []): any | null {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result: any = null;
  if (stmt.step()) result = stmt.getAsObject();
  stmt.free();
  return result;
}

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v']);

function parseMovieTitle(fileName: string): { title: string; year?: number } {
  const nameWithoutExt = path.basename(fileName, path.extname(fileName));
  const parenMatch = nameWithoutExt.match(/^(.+?)\s*\((\d{4})\)/);
  if (parenMatch) {
    return {
      title: parenMatch[1].replace(/[._]/g, ' ').trim(),
      year: parseInt(parenMatch[2]),
    };
  }
  const sceneMatch = nameWithoutExt.match(/^(.+?)[.\s_]+(19\d{2}|20\d{2})([.\s_]|$)/);
  if (sceneMatch) {
    return {
      title: sceneMatch[1].replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim(),
      year: parseInt(sceneMatch[2]),
    };
  }
  return { title: nameWithoutExt.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim() };
}

function scanFolder(folderPath: string) {
  const files: string[] = [];
  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          files.push(full);
        }
      }
    } catch {}
  }
  walk(folderPath);

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const { title, year } = parseMovieTitle(fileName);
    const existing = queryOne('SELECT id FROM movies WHERE filePath = ?', [filePath]);
    if (!existing) {
      let statSize = 0;
      try { statSize = fs.statSync(filePath).size; } catch {}
      db.run(`
        INSERT INTO movies (filePath, fileName, title, year, fileSize, dateAdded)
        VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
      `, [filePath, fileName, title, year || null, statSize]);
    }
  }
  saveDb();
  return files.length;
}

app.use(cors());
app.use(express.json());

// API Routes
app.get('/api/media/port', (req, res) => {
  res.json({ port: PORT });
});

app.get('/api/movies', (req, res) => {
  const { sortBy = 'dateAdded', order = 'desc' } = req.query;
  const sortCol = sortBy === 'title' ? 'm.title' : sortBy === 'year' ? 'm.year' : 'm.dateAdded';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
  const movies = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    ORDER BY ${sortCol} ${sortOrder}, m.title ASC
  `);
  res.json(movies);
});

app.get('/api/movies/count', (req, res) => {
  const row = queryOne('SELECT COUNT(*) as count FROM movies');
  res.json({ count: row ? row.count : 0 });
});

app.get('/api/movies/continue', (req, res) => {
  const movies = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    INNER JOIN watch_progress wp ON m.id = wp.movieId
    WHERE wp.position > 30 AND wp.completed = 0
    ORDER BY wp.lastPlayed DESC
    LIMIT 20
  `);
  res.json(movies);
});

app.get('/api/movies/recent', (req, res) => {
  const movies = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    ORDER BY m.dateAdded DESC
    LIMIT 20
  `);
  res.json(movies);
});

app.get('/api/movies/mylist', (req, res) => {
  const movies = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE m.isInMyList = 1
    ORDER BY m.title ASC
  `);
  res.json(movies);
});

app.get('/api/movies/genres', (req, res) => {
  const rows = queryAll('SELECT genres FROM movies WHERE genres != "[]" AND genres != ""');
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const g = JSON.parse(r.genres);
      if (Array.isArray(g)) g.forEach(item => set.add(item));
    } catch {}
  }
  res.json(Array.from(set).sort());
});

app.get('/api/movies/genre/:genre', (req, res) => {
  const genre = req.params.genre.toLowerCase();
  const movies = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE LOWER(m.genres) LIKE ?
    ORDER BY m.title ASC
  `, [`%${genre}%`]);
  res.json(movies);
});

app.get('/api/movies/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json([]);
  const like = `%${q}%`;
  const movies = queryAll(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE LOWER(m.title) LIKE ? OR LOWER(m.description) LIKE ? OR LOWER(m.genres) LIKE ? OR LOWER(m.director) LIKE ?
    ORDER BY m.title ASC
  `, [like, like, like, like]);
  res.json(movies);
});

app.get('/api/movies/:id', (req, res) => {
  const id = Number(req.params.id);
  const movie = queryOne(`
    SELECT m.*, wp.position, wp.lastPlayed, wp.watchCount, wp.completed
    FROM movies m
    LEFT JOIN watch_progress wp ON m.id = wp.movieId
    WHERE m.id = ?
  `, [id]);
  res.json(movie);
});

app.post('/api/movies/:id/progress', (req, res) => {
  const id = Number(req.params.id);
  const { position = 0, duration = 0 } = req.body;
  const completed = duration > 0 && position / duration > 0.9 ? 1 : 0;
  const existing = queryOne('SELECT id FROM watch_progress WHERE movieId = ?', [id]);
  if (existing) {
    db.run(`
      UPDATE watch_progress 
      SET position = ?, duration = ?, lastPlayed = strftime('%s', 'now'), completed = ?
      WHERE movieId = ?
    `, [position, duration, completed, id]);
  } else {
    db.run(`
      INSERT INTO watch_progress (movieId, position, duration, lastPlayed, watchCount, completed)
      VALUES (?, ?, ?, strftime('%s', 'now'), 1, ?)
    `, [id, position, duration, completed]);
  }
  saveDb();
  res.json({ success: true });
});

app.post('/api/movies/:id/mylist', (req, res) => {
  const id = Number(req.params.id);
  const movie = queryOne('SELECT isInMyList FROM movies WHERE id = ?', [id]);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  const val = movie.isInMyList ? 0 : 1;
  db.run('UPDATE movies SET isInMyList = ? WHERE id = ?', [val, id]);
  saveDb();
  res.json({ isInMyList: val === 1 });
});

app.get('/api/settings/:key', (req, res) => {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [req.params.key]);
  res.json({ value: row ? row.value : '' });
});

app.post('/api/settings/:key', (req, res) => {
  const { value } = req.body;
  const key = req.params.key;
  const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    db.run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  } else {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  saveDb();
  res.json({ success: true });
});

app.post('/api/library/scan', (req, res) => {
  const row = queryOne('SELECT value FROM settings WHERE key = "moviesFolder"');
  const folder = (row && row.value) ? row.value : 'E:\\Personal\\Movies';
  const total = scanFolder(folder);
  res.json({ totalFiles: total, newMovies: total });
});

// Stream Media with HTTP Range Support
app.get('/media/:id', (req, res) => {
  const id = Number(req.params.id);
  const movie = queryOne('SELECT filePath FROM movies WHERE id = ?', [id]);
  if (!movie || !fs.existsSync(movie.filePath)) {
    return res.status(404).send('Not found');
  }

  const filePath = movie.filePath;
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const mimeType = (mime as any).getType?.(filePath) || (mime as any).lookup?.(filePath) || 'video/mp4';
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const fileStream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// Serve frontend dist static assets
let distPath = path.join(__dirname, '../../dist');
if (!fs.existsSync(path.join(distPath, 'index.html'))) {
  distPath = path.join(__dirname, '../dist');
}
if (!fs.existsSync(path.join(distPath, 'index.html'))) {
  distPath = path.join(process.cwd(), 'dist');
}

console.log('Serving frontend from:', distPath);
app.use(express.static(distPath));

app.get('*', (req, res) => {
  const indexHtml = path.join(distPath, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(404).send('index.html not found. Please run vite build first.');
  }
});

async function main() {
  await initDb();
  console.log('Database initialized.');
  const initialCount = queryOne('SELECT COUNT(*) as count FROM movies');
  if (!initialCount || initialCount.count === 0) {
    console.log('Scanning E:\\Personal\\Movies...');
    scanFolder('E:\\Personal\\Movies');
    console.log('Scan complete.');
  }

  app.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`CineLocal Streaming Server Running!`);
    console.log(`Link: http://localhost:${PORT}`);
    console.log(`======================================================\n`);
  });
}

main().catch(console.error);
