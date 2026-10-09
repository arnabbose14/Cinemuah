import fs from 'fs';
import path from 'path';
import { upsertMovie, removeMovieByPath, getAllMoviePaths, getMovieById, updateMovie } from './movie-store';
import { getDb } from './database';
import { searchMovieMetadata, fetchMovieMetadata } from './metadata-service';
import { getSettings } from './movie-store';

const SUPPORTED_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.mpg', '.mpeg', '.flv', '.wmv']);

interface ScanProgress {
  phase: string;
  current: number;
  total: number;
  message: string;
}

interface ScanResult {
  totalFiles: number;
  newMovies: number;
  removedMovies: number;
  failedMovies: number;
  skippedMovies: number;
}

type ProgressCallback = (data: ScanProgress) => void;

function parseMovieTitle(fileName: string): { title: string; year?: number } {
  // Remove file extension
  const nameWithoutExt = path.basename(fileName, path.extname(fileName));
  
  // Try pattern: "Title (Year)"
  const parenMatch = nameWithoutExt.match(/^(.+?)\s*\((\d{4})\)/);
  if (parenMatch) {
    return {
      title: parenMatch[1].replace(/[._]/g, ' ').trim(),
      year: parseInt(parenMatch[2]),
    };
  }
  
  // Try pattern: "Title.Year." or "Title Year " where Year is 19xx or 20xx
  const sceneMatch = nameWithoutExt.match(/^(.+?)[.\s_]+(19\d{2}|20\d{2})([.\s_]|$)/);
  if (sceneMatch) {
    const rawTitle = sceneMatch[1].replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
    const year = parseInt(sceneMatch[2]);
    return {
      title: rawTitle,
      year,
    };
  }
  
  // Just clean up the name
  const cleanTitle = nameWithoutExt
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  return { title: cleanTitle };
}

function findVideoFiles(folderPath: string): string[] {
  const results: string[] = [];
  
  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Hidden folders (e.g. .cinelocal-downloads staging) hold partial downloads
          if (!entry.name.startsWith('.')) walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            results.push(fullPath);
          }
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${dir}:`, err);
    }
  }
  
  walk(folderPath);
  return results;
}

export async function scanLibrary(
  folderPath: string,
  onProgress: ProgressCallback
): Promise<ScanResult> {
  const result: ScanResult = {
    totalFiles: 0,
    newMovies: 0,
    removedMovies: 0,
    failedMovies: 0,
    skippedMovies: 0,
  };
  
  // Phase 1: Verify folder
  onProgress({ phase: 'init', current: 0, total: 0, message: 'Scanning movie folder...' });
  
  if (!fs.existsSync(folderPath)) {
    throw new Error(`Movie folder not found: ${folderPath}`);
  }
  
  // Phase 2: Find all video files
  onProgress({ phase: 'scanning', current: 0, total: 0, message: 'Finding video files...' });
  const videoFiles = findVideoFiles(folderPath);
  result.totalFiles = videoFiles.length;
  
  // Phase 3: Remove movies that no longer exist
  onProgress({ phase: 'cleanup', current: 0, total: 0, message: 'Checking for removed files...' });
  const existingPaths = getAllMoviePaths();
  for (const existingPath of existingPaths) {
    if (!fs.existsSync(existingPath)) {
      removeMovieByPath(existingPath);
      result.removedMovies++;
    }
  }
  
  // Phase 4: Add new movies
  const apiKey = getSettings('tmdbApiKey') || '';
  
  for (let i = 0; i < videoFiles.length; i++) {
    const filePath = videoFiles[i];
    const fileName = path.basename(filePath);
    
    onProgress({
      phase: 'indexing',
      current: i + 1,
      total: videoFiles.length,
      message: `Indexing: ${fileName}`,
    });
    
    try {
      const stat = fs.statSync(filePath);
      const { title, year } = parseMovieTitle(fileName);
      
      // Upsert into database
      const movieId = upsertMovie({
        filePath,
        fileName,
        title,
        year,
        fileSize: stat.size,
      });
      
      // Check if this is a new movie (no metadata yet)
      const movie = getMovieById(movieId);
      const isNew = !movie?.description && !movie?.poster;
      
      if (isNew) {
        result.newMovies++;
        
        // Try to fetch metadata if API key is configured
        if (apiKey) {
          try {
            onProgress({
              phase: 'metadata',
              current: i + 1,
              total: videoFiles.length,
              message: `Fetching metadata: ${title}`,
            });
            
            const searchResults = await searchMovieMetadata(title, year, apiKey);
            if (searchResults && searchResults.length > 0) {
              const metadata = await fetchMovieMetadata(searchResults[0].id, apiKey);
              if (metadata) {
                updateMovie(movieId, {
                  title: metadata.title,
                  year: metadata.year,
                  description: metadata.description,
                  poster: metadata.poster,
                  backdrop: metadata.backdrop,
                  rating: metadata.rating,
                  duration: metadata.duration,
                  genres: metadata.genres,
                  cast: metadata.cast,
                  director: metadata.director,
                  writers: metadata.writers,
                  tmdbId: metadata.tmdbId,
                });
              }
            }
          } catch (metaErr) {
            console.error(`Failed to fetch metadata for ${title}:`, metaErr);
            result.failedMovies++;
          }
        }
      } else {
        result.skippedMovies++;
      }
    } catch (err) {
      console.error(`Error processing ${filePath}:`, err);
      result.failedMovies++;
    }
  }
  
  return result;
}
