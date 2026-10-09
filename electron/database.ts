import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

let db: SqlJsDatabase;
let dbPath: string;

export function getDb(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized');
  return db;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Writes the database to disk right now. */
export function flushDb(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (db && dbPath) {
    try {
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
    } catch (err) {
      console.error('Failed to save database file:', err);
    }
  }
}

/**
 * Schedules a write. Callers save after every change (a library scan does it hundreds of times),
 * so writes are coalesced into one shortly afterwards instead of exporting the whole database each time.
 */
export function saveDb(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(flushDb, 400);
}

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'cinelocal.sqlite');
  
  console.log(`Database path: ${dbPath}`);

  let wasmPath = '';
  try {
    const sqlJsModulePath = require.resolve('sql.js');
    const cand = path.join(path.dirname(sqlJsModulePath), 'sql-wasm.wasm');
    if (fs.existsSync(cand)) wasmPath = cand;
  } catch {}

  if (!wasmPath) {
    const distWasm = path.join(__dirname, 'sql-wasm.wasm');
    if (fs.existsSync(distWasm)) wasmPath = distWasm;
    else wasmPath = path.join(__dirname, '../dist-electron/sql-wasm.wasm');
  }

  const SQL = await initSqlJs({
    locateFile: () => wasmPath
  });
  
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
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

  // Insert default settings
  const defaultSettings: [string, string][] = [
    ['moviesFolder', 'E:\\Personal\\Movies'],
    ['tmdbApiKey', ''],
    ['autoResume', 'true'],
    ['defaultSpeed', '1'],
    ['rememberVolume', 'true'],
    ['volume', '1'],
    ['accentColor', '#e50914'],
    ['cardSize', 'comfortable']
  ];

  for (const [k, v] of defaultSettings) {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = :key');
    stmt.bind({ ':key': k });
    if (!stmt.step()) {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
    stmt.free();
  }

  saveDb();
  console.log('Database initialized successfully with sql.js');
}
