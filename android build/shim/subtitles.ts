// Captions on Android: online search (OpenSubtitles) and files picked from the phone.
// Embedded tracks and sidecar files are not available (no ffmpeg, and the library is only reachable through the player).
import type { SubtitleTrack } from '../../src/types';
import { httpGet, httpGetBytes } from './native';

const OS_HEADERS = { 'X-User-Agent': 'TemporaryUserAgent' };

const LANGS: [string, string[], string][] = [
  ['en', ['eng'], 'English'], ['hi', ['hin'], 'Hindi'], ['bn', ['ben'], 'Bengali'], ['ta', ['tam'], 'Tamil'],
  ['te', ['tel'], 'Telugu'], ['ml', ['mal'], 'Malayalam'], ['kn', ['kan'], 'Kannada'], ['mr', ['mar'], 'Marathi'],
  ['pa', ['pan'], 'Punjabi'], ['ur', ['urd'], 'Urdu'], ['es', ['spa'], 'Spanish'], ['fr', ['fre', 'fra'], 'French'],
  ['de', ['ger', 'deu'], 'German'], ['it', ['ita'], 'Italian'], ['pt', ['por', 'pob'], 'Portuguese'],
  ['ru', ['rus'], 'Russian'], ['pl', ['pol'], 'Polish'], ['nl', ['dut', 'nld'], 'Dutch'], ['sv', ['swe'], 'Swedish'],
  ['da', ['dan'], 'Danish'], ['tr', ['tur'], 'Turkish'], ['ar', ['ara'], 'Arabic'], ['fa', ['per', 'fas'], 'Persian'],
  ['ja', ['jpn'], 'Japanese'], ['ko', ['kor'], 'Korean'], ['zh', ['chi', 'zho', 'zht'], 'Chinese'], ['th', ['tha'], 'Thai'],
  ['id', ['ind'], 'Indonesian'], ['vi', ['vie'], 'Vietnamese'], ['he', ['heb'], 'Hebrew'], ['el', ['ell', 'gre'], 'Greek'],
  ['cs', ['cze', 'ces'], 'Czech'], ['hu', ['hun'], 'Hungarian'], ['ro', ['rum', 'ron'], 'Romanian'], ['fi', ['fin'], 'Finnish'],
  ['no', ['nor'], 'Norwegian'], ['uk', ['ukr'], 'Ukrainian'],
];
const iso2To3 = (c: string): string[] => LANGS.find(l => l[0] === c)?.[1] ?? [];
const langFromCode = (code: string) => {
  const c = (code || '').toLowerCase();
  const hit = LANGS.find(l => l[0] === c || l[1].includes(c));
  return hit ? { iso2: hit[0], name: hit[2] } : { iso2: '', name: '' };
};

const ENCODINGS: Record<string, string> = {
  CP1250: 'windows-1250', CP1251: 'windows-1251', CP1252: 'windows-1252', CP1253: 'windows-1253', CP1254: 'windows-1254',
  CP1255: 'windows-1255', CP1256: 'windows-1256', CP1257: 'windows-1257', 'UTF-8': 'utf-8', UTF8: 'utf-8', BIG5: 'big5',
  GBK: 'gbk', GB2312: 'gbk', SHIFT_JIS: 'shift_jis', CP932: 'shift_jis', 'EUC-KR': 'euc-kr', CP949: 'euc-kr', 'KOI8-R': 'koi8-r',
  'ISO-8859-1': 'iso-8859-1', 'ISO-8859-2': 'iso-8859-2', 'ISO-8859-7': 'iso-8859-7', 'ISO-8859-9': 'iso-8859-9',
};

/** UTF-8 first, then the encoding the source reports (subtitle files come in every legacy encoding). */
function decode(bytes: Uint8Array, hint?: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    const label = (hint && ENCODINGS[hint.toUpperCase()]) || 'windows-1252';
    try { return new TextDecoder(label).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
  }
}

function srtToVtt(text: string): string {
  let t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(t)) return t;
  t = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2').replace(/\{[^}]*\}/g, '').replace(/<\/?font[^>]*>/gi, '');
  return 'WEBVTT\n\n' + t.trim() + '\n';
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!(bytes[0] === 0x1f && bytes[1] === 0x8b)) return bytes;
  const DS = (window as any).DecompressionStream;
  if (!DS) throw new Error('This device cannot unpack subtitle archives');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DS('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

interface Query { imdbId?: string; season?: number; episode?: number; title?: string; year?: number; languages: string[] }

const searchCache = new Map<string, { time: number; tracks: SubtitleTrack[] }>();

async function searchOnline(q: Query): Promise<SubtitleTrack[]> {
  const langs = (q.languages.length ? q.languages : ['en']).flatMap(iso2To3);
  if (langs.length === 0) langs.push('eng');
  const lang = langs.join(',');
  // The service wants the IMDb id zero-padded to 7 digits (older films: tt0111161)
  const digits = (q.imdbId || '').replace(/^tt/, '').replace(/\D/g, '');
  const imdb = digits ? digits.padStart(7, '0') : '';
  let route: string;
  if (imdb && q.season && q.episode) route = `episode-${q.episode}/imdbid-${imdb}/season-${q.season}/sublanguageid-${lang}`;
  else if (imdb) route = `imdbid-${imdb}/sublanguageid-${lang}`;
  else if (q.title) {
    const query = encodeURIComponent(`${q.title}${q.year ? ' ' + q.year : ''}`.toLowerCase());
    route = `${q.season && q.episode ? `episode-${q.episode}/` : ''}query-${query}${q.season && q.episode ? `/season-${q.season}` : ''}/sublanguageid-${lang}`;
  } else return [];

  const hit = searchCache.get(route);
  if (hit && Date.now() - hit.time < 10 * 60 * 1000) return hit.tracks;

  const { status, body } = await httpGet(`https://rest.opensubtitles.org/search/${route}`, 15000, OS_HEADERS);
  if (status === 429) throw new Error('OpenSubtitles is rate limiting requests. Try again in a minute.');
  if (status < 200 || status >= 300) throw new Error(`Subtitle search failed (HTTP ${status})`);
  const list = JSON.parse(body) as any[];
  const tracks = list
    .filter(s => s.SubBad !== '1' && s.SubDownloadLink)
    .sort((a, b) => Number(b.SubDownloadsCnt) - Number(a.SubDownloadsCnt))
    .slice(0, 40)
    .map((s): SubtitleTrack => {
      const l = langFromCode(s.ISO639 || '');
      const release = String(s.MovieReleaseName || s.SubFileName || '').replace(/\.[^.]+$/, '');
      return {
        id: 'os:' + JSON.stringify({ link: s.SubDownloadLink, enc: s.SubEncoding || '', fmt: s.SubFormat || 'srt', name: s.SubFileName }),
        label: `${l.name || s.LanguageName || s.SubLanguageID} · ${release.slice(0, 70)}`,
        lang: l.iso2,
        source: 'online',
        detail: `${String(s.SubFormat || 'srt').toUpperCase()} · ${Number(s.SubDownloadsCnt).toLocaleString()} downloads${s.SubHearingImpaired === '1' ? ' · HI' : ''}`,
      };
    });
  searchCache.set(route, { time: Date.now(), tracks });
  return tracks;
}

const vttCache = new Map<string, { label: string; vtt: string }>();

async function loadTrack(id: string): Promise<{ label: string; vtt: string }> {
  if (!id.startsWith('os:')) throw new Error('Unknown subtitle track');
  const cached = vttCache.get(id);
  if (cached) return cached;
  const meta = JSON.parse(id.slice(3)) as { link: string; enc: string; fmt: string; name: string };
  const { status, bytes } = await httpGetBytes(meta.link, 20000, OS_HEADERS);
  if (status !== 200) throw new Error(`Subtitle download failed (HTTP ${status})`);
  const text = decode(await gunzip(bytes), meta.enc);
  const result = { label: meta.name, vtt: srtToVtt(text) };
  vttCache.set(id, result);
  return result;
}

/** Lets the user choose a .srt / .vtt from the phone. */
function pickFile(): Promise<{ label: string; vtt: string } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,text/vtt,application/x-subrip,text/plain';
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) { resolve(null); return; }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        resolve({ label: file.name, vtt: srtToVtt(decode(bytes)) });
      } catch { resolve(null); }
    };
    input.oncancel = () => { input.remove(); resolve(null); };
    document.body.appendChild(input);
    input.click();
  });
}

export const subtitlesApi = {
  local: async (_moviePath: string): Promise<SubtitleTrack[]> => [],
  search: searchOnline,
  load: loadTrack,
  pickFile,
};
