import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

interface ImdbSuggestion {
  id: string;
  l: string; // title
  y?: number; // year
  s?: string; // stars / cast
  i?: {
    imageUrl: string;
    width: number;
    height: number;
  };
  q?: string; // feature, TV series, etc.
}

async function searchImdb(title: string, year?: number): Promise<{
  poster?: string;
  backdrop?: string;
  cast?: string[];
  imdbId?: string;
  matchedTitle?: string;
  matchedYear?: number;
} | null> {
  try {
    // Sanitize title for IMDb suggestion endpoint
    let clean = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (!clean) return null;

    const slug = clean.replace(/\s+/g, '_');
    const firstChar = slug[0];
    const url = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(slug)}.json`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) return null;
    const data = await res.json() as { d?: ImdbSuggestion[] };
    if (!data.d || data.d.length === 0) return null;

    // Filter for movies/features first
    let item = data.d.find(d => {
      if (year && d.y) {
        return Math.abs(d.y - year) <= 1;
      }
      return d.q === 'feature' || d.q === 'TV series';
    });

    if (!item) {
      item = data.d[0];
    }

    const poster = item?.i?.imageUrl;
    const cast = item?.s ? item.s.split(',').map(s => s.trim()) : [];

    return {
      poster,
      backdrop: poster, // High-res IMDb poster doubles as backdrop card
      cast,
      imdbId: item?.id,
      matchedTitle: item?.l,
      matchedYear: item?.y,
    };
  } catch (err) {
    return null;
  }
}

async function run() {
  console.log('--- Fetching IMDb Movie Posters & Metadata ---');

  const DB_FILE = path.join(__dirname, '../cinelocal-web.sqlite');
  if (!fs.existsSync(DB_FILE)) {
    console.error('Database file not found at:', DB_FILE);
    return;
  }

  const sqlModule = require.resolve('sql.js');
  const wasmPath = path.join(path.dirname(sqlModule), 'sql-wasm.wasm');
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = new SQL.Database(fs.readFileSync(DB_FILE));

  const rows: any[] = [];
  const stmt = db.prepare('SELECT id, title, year, fileName, poster FROM movies');
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();

  console.log(`Found ${rows.length} movies in library.`);
  let updatedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const movie = rows[i];
    // Skip if already has poster
    if (movie.poster && movie.poster.startsWith('http')) {
      continue;
    }

    process.stdout.write(`[${i + 1}/${rows.length}] Fetching IMDb for: "${movie.title}" (${movie.year || 'N/A'})... `);
    const result = await searchImdb(movie.title, movie.year);

    if (result && result.poster) {
      const castArray = (result.cast || []).map(name => ({ name, character: 'Star' }));
      const castJson = JSON.stringify(castArray);

      db.run(`
        UPDATE movies 
        SET poster = ?, backdrop = ?, cast = ?
        WHERE id = ?
      `, [result.poster, result.backdrop || result.poster, castJson, movie.id]);

      updatedCount++;
      console.log(`Found (${result.imdbId})`);
    } else {
      console.log(`No poster`);
    }

    // Gentle rate limit delay (100ms)
    await new Promise(r => setTimeout(r, 100));
  }

  // Save updated database
  const exported = db.export();
  fs.writeFileSync(DB_FILE, Buffer.from(exported));
  console.log(`\n======================================================`);
  console.log(`Successfully updated ${updatedCount} movies with IMDb posters!`);
  console.log(`======================================================`);
}

run().catch(console.error);
