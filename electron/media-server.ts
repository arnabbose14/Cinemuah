import http from 'http';
import fs from 'fs';
import path from 'path';
import mime from 'mime';
import { getMovieById, getSettings } from './movie-store';
import { getTorrentFile } from './torrent-service';
import { probe, transcodeTo, streamStartAt } from './transcoder';
import { fetchYtsImage } from './yts-service';

let server: http.Server | null = null;
let serverPort = 0;

// Allowed video extensions for security
const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.mpg', '.mpeg', '.flv', '.wmv']);

function isPathSafe(requestedPath: string, moviesFolder: string): boolean {
  const normalized = path.normalize(requestedPath).toLowerCase();
  const normalizedMoviesFolder = path.normalize(moviesFolder).toLowerCase();
  return normalized.startsWith(normalizedMoviesFolder);
}

export function startMediaServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS headers for Electron renderer
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }

      const url = new URL(req.url || '/', `http://localhost`);
      
      // Route: /media/:movieId - serve movie by ID
      const mediaMatch = url.pathname.match(/^\/media\/(\d+)$/);
      if (mediaMatch) {
        const movieId = parseInt(mediaMatch[1]);
        serveMovieById(movieId, req, res);
        return;
      }

      // Route: /poster/:movieId - serve poster image
      const posterMatch = url.pathname.match(/^\/poster\/(\d+)$/);
      if (posterMatch) {
        const movieId = parseInt(posterMatch[1]);
        servePoster(movieId, req, res);
        return;
      }

      // Route: /thumbnail/:movieId - serve backdrop/thumbnail
      const thumbnailMatch = url.pathname.match(/^\/thumbnail\/(\d+)$/);
      if (thumbnailMatch) {
        const movieId = parseInt(thumbnailMatch[1]);
        serveBackdrop(movieId, req, res);
        return;
      }

      // Route: /trailer?v=<youtube id> - tiny page that embeds the trailer from an http origin
      if (url.pathname === '/trailer') {
        const id = (url.searchParams.get('v') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
        if (!id) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000}iframe{border:0;width:100%;height:100%}</style><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&origin=${encodeURIComponent('http://127.0.0.1:' + serverPort)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`);
        return;
      }

      // Route: /yts-image?u=<https url> - YTS artwork, fetched around ISP DNS blocking
      if (url.pathname === '/yts-image') {
        const target = url.searchParams.get('u') || '';
        fetchYtsImage(target).then(img => {
          res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.body.length, 'Cache-Control': 'max-age=86400' });
          res.end(img.body);
        }).catch(() => {
          res.writeHead(404);
          res.end();
        });
        return;
      }

      // Routes: /info/... (JSON: duration + whether direct play works) and
      //         /transcode/...?start=SECONDS (fragmented MP4) for media/:id and torrent/:hash/:idx
      const tcMatch = url.pathname.match(/^\/(info|transcode|keyframe)\/(media\/\d+|torrent\/[0-9a-fA-F]{40}\/\d+)$/);
      if (tcMatch) {
        handleTranscodeRoute(tcMatch[1] as 'info' | 'transcode' | 'keyframe', tcMatch[2], parseFloat(url.searchParams.get('start') || '0') || 0, req, res, parseInt(url.searchParams.get('audio') || '0', 10) || 0);
        return;
      }

      // Route: /torrent/:infoHash/:fileIndex - stream the active torrent's video file
      const torrentMatch = url.pathname.match(/^\/torrent\/([0-9a-fA-F]{40})\/(\d+)$/);
      if (torrentMatch) {
        serveTorrent(torrentMatch[1].toLowerCase(), parseInt(torrentMatch[2]), req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (address && typeof address === 'object') {
        serverPort = address.port;
        resolve(address.port);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });

    server.on('error', reject);
  });
}

function serveMovieById(movieId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const movie = getMovieById(movieId);
    
    if (!movie) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Movie not found');
      return;
    }

    const moviesFolder = getSettings('moviesFolder') || 'E:\\Personal\\Movies';
    
    // Security: validate path is within movies folder
    if (!isPathSafe(movie.filePath, moviesFolder)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(movie.filePath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: unsupported file type');
      return;
    }

    serveFile(movie.filePath, req, res);
  } catch (error) {
    console.error('Error serving movie:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

/** Remote artwork goes through the DNS-safe image fetcher; anything else is redirected. */
function sendRemoteImage(target: string, res: http.ServerResponse) {
  fetchYtsImage(target).then(img => {
    res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.body.length, 'Cache-Control': 'max-age=86400' });
    res.end(img.body);
  }).catch(() => {
    res.writeHead(302, { Location: target });
    res.end();
  });
}

function servePoster(movieId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const movie = getMovieById(movieId);
    
    if (!movie || !movie.poster) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (movie.poster.startsWith('http')) {
      sendRemoteImage(movie.poster, res);
      return;
    }

    if (fs.existsSync(movie.poster)) {
      serveFile(movie.poster, req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (error) {
    res.writeHead(500);
    res.end();
  }
}

function serveBackdrop(movieId: number, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    const movie = getMovieById(movieId);
    
    if (!movie || !movie.backdrop) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (movie.backdrop.startsWith('http')) {
      sendRemoteImage(movie.backdrop, res);
      return;
    }

    if (fs.existsSync(movie.backdrop)) {
      serveFile(movie.backdrop, req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  } catch (error) {
    res.writeHead(500);
    res.end();
  }
}

async function handleTranscodeRoute(
  kind: 'info' | 'transcode' | 'keyframe',
  target: string,
  startSec: number,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  audioOrd = 0
) {
  try {
    let input: string;
    const parts = target.split('/');
    if (parts[0] === 'media') {
      const movie = getMovieById(parseInt(parts[1]));
      const moviesFolder = getSettings('moviesFolder') || 'E:\\Personal\\Movies';
      if (!movie || !isPathSafe(movie.filePath, moviesFolder) || !fs.existsSync(movie.filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      input = movie.filePath;
    } else {
      if (!getTorrentFile(parts[1].toLowerCase(), parseInt(parts[2]))) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Stream not active');
        return;
      }
      input = `http://127.0.0.1:${serverPort}/torrent/${parts[1].toLowerCase()}/${parts[2]}`;
    }

    if (kind === 'keyframe') {
      const start = await streamStartAt(input, Math.max(0, startSec));
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify({ start }));
    } else if (kind === 'info') {
      const info = await probe(input);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(info));
    } else {
      await transcodeTo(input, Math.max(0, startSec), req, res, audioOrd);
    }
  } catch (error) {
    console.error('Transcode route error:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}

function serveTorrent(infoHash: string, fileIndex: number, req: http.IncomingMessage, res: http.ServerResponse) {
  const file = getTorrentFile(infoHash, fileIndex);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Stream not active');
    return;
  }

  const size = file.length;
  const mimeType = (mime as any).getType?.(file.name) || 'video/mp4';
  const range = req.headers.range;
  let start = 0;
  let end = size - 1;

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
    if (m[1]) {
      start = parseInt(m[1], 10);
      if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1);
    } else {
      // suffix range: last N bytes
      start = Math.max(0, size - parseInt(m[2], 10));
    }
    if (start >= size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }
  }

  const headers: http.OutgoingHttpHeaders = {
    'Content-Type': mimeType,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, headers);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = file.createReadStream({ start, end });
  stream.pipe(res);
  // The player aborts requests constantly while seeking; stop downloading for them.
  res.on('close', () => stream.destroy());
  stream.on('error', () => res.destroy());
}

function serveFile(filePath: string, req: http.IncomingMessage, res: http.ServerResponse) {
  try {
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
        res.writeHead(416, {
          'Content-Range': `bytes */${fileSize}`,
        });
        res.end();
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
      fileStream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
        }
        res.end();
      });
    }
  } catch (error) {
    console.error('Error serving file:', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error serving file');
    }
  }
}

export function stopMediaServer() {
  server?.close();
  server = null;
}
