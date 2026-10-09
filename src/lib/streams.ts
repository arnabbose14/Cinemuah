import type { YtsMovie, YtsTorrent, SeriesShow, SeriesEpisode, SeriesTorrent, StreamHistoryItem, SubtitleContext } from '@/types';
import { pickDefaultEpisodeTorrent } from '@/types';

export type HistoryMeta = Omit<StreamHistoryItem, 'position' | 'duration' | 'completed' | 'updatedAt'>;

/** Everything the torrent player needs: what to stream, how to remember it, and how to caption it. */
export interface StreamSpec {
  title: string;
  magnet: string;
  /** Saved as watch history so the title shows up under Continue Watching. */
  history?: HistoryMeta;
  subtitleContext?: SubtitleContext;
  startPosition?: number;
  /** Other sources for the same title, tried automatically when this one can't be reached. */
  alternatives?: StreamSpec[];
  /** Set for streamed episodes: lets the player offer "Next episode". */
  episode?: { show: SeriesShow; ep: SeriesEpisode };
}

const pad = (n: number) => String(n).padStart(2, '0');
const peersOf = (t: { seeds: number; peers: number }) => t.seeds * 2 + t.peers;

export function movieStream(movie: YtsMovie, torrent: YtsTorrent, withAlternatives = true): StreamSpec {
  const spec: StreamSpec = {
    title: `${movie.title} (${movie.year}) · ${torrent.quality}`,
    magnet: torrent.magnet,
    history: {
      key: `yts:${movie.id}`, kind: 'movie', title: movie.title, subtitle: `${movie.year} · ${torrent.quality}`,
      poster: movie.poster, magnet: torrent.magnet, quality: torrent.quality, imdbId: movie.imdbCode,
      year: movie.year, season: 0, episode: 0, genres: movie.genres.join(','),
    },
    subtitleContext: { title: movie.title, year: movie.year, imdbId: movie.imdbCode },
  };
  if (withAlternatives) {
    spec.alternatives = movie.torrents
      .filter(t => t.hash !== torrent.hash && (t.seeds > 0 || t.peers > 0))
      .sort((a, b) => Number(b.quality === torrent.quality) - Number(a.quality === torrent.quality) || peersOf(b) - peersOf(a))
      .slice(0, 3)
      .map(t => movieStream(movie, t, false));
  }
  return spec;
}

export function episodeStream(show: SeriesShow, ep: SeriesEpisode, torrent: SeriesTorrent, withAlternatives = true): StreamSpec {
  const code = `S${pad(ep.season)}E${pad(ep.number)}`;
  const spec: StreamSpec = {
    title: `${show.title} ${code} · ${torrent.quality}`,
    magnet: torrent.magnet,
    history: {
      key: `ep:${show.id}:${ep.season}x${ep.number}`, kind: 'episode', title: show.title,
      subtitle: `${code}${ep.name ? ' · ' + ep.name : ''}`, poster: show.poster, magnet: torrent.magnet,
      quality: torrent.quality, imdbId: show.imdbId, year: show.year, season: ep.season, episode: ep.number,
      genres: show.genres.join(','),
    },
    subtitleContext: { title: show.title, year: show.year, imdbId: show.imdbId, season: ep.season, episode: ep.number },
    episode: { show, ep },
  };
  if (withAlternatives) {
    spec.alternatives = ep.torrents
      .filter(t => t.hash !== torrent.hash && (t.seeds > 0 || t.peers > 0))
      .sort((a, b) => Number(b.quality === torrent.quality) - Number(a.quality === torrent.quality) || peersOf(b) - peersOf(a))
      .slice(0, 3)
      .map(t => episodeStream(show, ep, t, false));
  }
  return spec;
}

/** Resume a streamed title from where it was left. */
export function specFromHistory(item: StreamHistoryItem): StreamSpec {
  const { position, duration, completed, updatedAt, ...meta } = item;
  void duration; void completed; void updatedAt;
  const code = item.kind === 'episode' ? ` S${pad(item.season)}E${pad(item.episode)}` : item.year ? ` (${item.year})` : '';
  return {
    title: `${item.title}${code} · ${item.quality}`,
    magnet: item.magnet,
    history: meta,
    subtitleContext: item.kind === 'episode'
      ? { title: item.title, year: item.year, imdbId: item.imdbId, season: item.season, episode: item.episode }
      : { title: item.title, year: item.year, imdbId: item.imdbId },
    startPosition: position,
  };
}

export interface NextEpisode { label: string; spec: StreamSpec }

/** The episode after the one being streamed (that has aired and has a source), or null. */
export async function findNextEpisode(spec: StreamSpec): Promise<NextEpisode | null> {
  const h = spec.history;
  if (!h || h.kind !== 'episode') return null;
  try {
    const showId = spec.episode?.show.id ?? Number(h.key.split(':')[1]);
    const detail = await window.electronAPI.series.get(showId);
    const today = new Date().toISOString().slice(0, 10);
    const after = detail.episodes
      .filter(e => e.torrents.length > 0 && (!e.airdate || e.airdate <= today)
        && (e.season > h.season || (e.season === h.season && e.number > h.episode)))
      .sort((a, b) => a.season - b.season || a.number - b.number)[0];
    if (!after) return null;
    const torrent = pickDefaultEpisodeTorrent(after.torrents);
    if (!torrent) return null;
    return { label: `S${pad(after.season)}E${pad(after.number)}${after.name ? ' · ' + after.name : ''}`, spec: episodeStream(detail.show, after, torrent) };
  } catch {
    return null;
  }
}
