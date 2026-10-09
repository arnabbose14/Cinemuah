// Captions: files next to a local video, embedded tracks (via FFmpeg), manually loaded files, and online search.
// Everything is normalised to WebVTT text; the player parses and renders it itself.
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';
import { app, BrowserWindow, dialog } from 'electron';
import { probe, runFfmpeg } from './transcoder';
import { resilientFetch } from './net-util';

export interface SubtitleTrack {
  id: string;                 // file:<path> | emb:<path>|<stream> | os:<json>
  label: string;
  lang: string;               // ISO 639-1 where known ('' otherwise)
  source: 'file' | 'embedded' | 'online';
  detail?: string;            // format / downloads, shown small
}

export interface OnlineQuery {
  imdbId?: string;            // tt1234567
  season?: number;
  episode?: number;
  title?: string;
  year?: number;
  languages: string[];        // ISO 639-1, e.g. ['en', 'es']
}

// ─── language tables ────────────────────────────────────────────────

// ISO 639-1, ISO 639-2 codes OpenSubtitles uses, English name
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

function langFromCode(code: string): { iso2: string; name: string } {
  const c = (code || '').toLowerCase();
  const hit = LANGS.find(l => l[0] === c || l[1].includes(c));
  return hit ? { iso2: hit[0], name: hit[2] } : { iso2: '', name: '' };
}

function langFromFileName(name: string): { iso2: string; name: string } {
  const tokens = name.toLowerCase().replace(/\.[^.]+$/, '').split(/[.\s_\-()[\]]+/).filter(Boolean);
  for (const tok of tokens.reverse()) {
    const hit = LANGS.find(l => l[0] === tok || l[1].includes(tok) || l[2].toLowerCase() === tok);
    if (hit) return { iso2: hit[0], name: hit[2] };
  }
  return { iso2: '', name: '' };
}

// ─── text handling ──────────────────────────────────────────────────

const ENCODINGS: Record<string, string> = {
  CP1250: 'windows-1250', CP1251: 'windows-1251', CP1252: 'windows-1252', CP1253: 'windows-1253', CP1254: 'windows-1254',
  CP1255: 'windows-1255', CP1256: 'windows-1256', CP1257: 'windows-1257', CP1258: 'windows-1258',
  'UTF-8': 'utf-8', UTF8: 'utf-8', BIG5: 'big5', GBK: 'gbk', GB2312: 'gbk', SHIFT_JIS: 'shift_jis', CP932: 'shift_jis',
  'EUC-KR': 'euc-kr', CP949: 'euc-kr', 'KOI8-R': 'koi8-r', 'ISO-8859-1': 'iso-8859-1', 'ISO-8859-2': 'iso-8859-2',
  'ISO-8859-7': 'iso-8859-7', 'ISO-8859-9': 'iso-8859-9', 'ISO-8859-15': 'iso-8859-15',
};

/** Subtitle files come in every legacy encoding; UTF-8 is tried first, then the encoding the source reports. */
export function decodeSubtitle(buf: Buffer, hint?: string): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8').replace(/^﻿/, '');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf).replace(/^﻿/, '');
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf).replace(/^﻿/, '');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    const label = (hint && ENCODINGS[hint.toUpperCase()]) || 'windows-1252';
    try { return new TextDecoder(label).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
  }
}

function srtToVtt(text: string): string {
  let t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(t)) return t;
  t = t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2');   // 00:01:02,500 -> 00:01:02.500
  t = t.replace(/\{[^}]*\}/g, '');                                // {\an8}-style overrides
  t = t.replace(/<\/?font[^>]*>/gi, '');
  return 'WEBVTT\n\n' + t.trim() + '\n';
}

async function toVtt(buf: Buffer, ext: string, encodingHint?: string): Promise<string> {
  const e = ext.toLowerCase().replace('.', '');
  if (e === 'ass' || e === 'ssa' || e === 'sub' || e === 'smi' || e === 'sbv') {
    const tmp = path.join(os.tmpdir(), `cinemuah-sub-${crypto.randomBytes(6).toString('hex')}.${e}`);
    try {
      fs.writeFileSync(tmp, decodeSubtitle(buf, encodingHint), 'utf8');
      return decodeSubtitle(await runFfmpeg(['-sub_charenc', 'UTF-8', '-i', tmp, '-f', 'webvtt', 'pipe:1'], 60000));
    } finally {
      try { fs.unlinkSync(tmp); } catch { /* temp file */ }
    }
  }
  return srtToVtt(decodeSubtitle(buf, encodingHint));
}

// ─── local files + embedded tracks ──────────────────────────────────

const SUB_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub', '.smi', '.sbv']);
const TEXT_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'subviewer', 'microdvd']);

function findSiblingFiles(moviePath: string): string[] {
  const dir = path.dirname(moviePath);
  const base = path.basename(moviePath, path.extname(moviePath)).toLowerCase();
  const found: string[] = [];
  const scan = (folder: string, requireMatch: boolean) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isFile() || !SUB_EXT.has(path.extname(e.name).toLowerCase())) continue;
      if (requireMatch && !e.name.toLowerCase().startsWith(base)) continue;
      found.push(path.join(folder, e.name));
    }
  };
  scan(dir, true);
  for (const sub of ['Subs', 'subs', 'Subtitles', 'subtitles', 'Sub']) {
    const folder = path.join(dir, sub);
    if (fs.existsSync(folder)) scan(folder, false);
  }
  return found;
}

export async function listLocalTracks(moviePath: string): Promise<SubtitleTrack[]> {
  const tracks: SubtitleTrack[] = [];
  if (!moviePath || !fs.existsSync(moviePath)) return tracks;

  for (const file of findSiblingFiles(moviePath)) {
    const lang = langFromFileName(path.basename(file));
    tracks.push({
      id: `file:${file}`,
      label: lang.name || path.basename(file),
      lang: lang.iso2,
      source: 'file',
      detail: lang.name ? path.basename(file) : path.extname(file).slice(1).toUpperCase(),
    });
  }

  try {
    const info = await probe(moviePath);
    for (const s of info.subtitles) {
      if (!TEXT_CODECS.has(s.codec)) continue;      // image-based (PGS/DVD) subtitles cannot be shown as text
      const lang = langFromCode(s.lang);
      tracks.push({
        id: `emb:${moviePath}|${s.index}`,
        label: lang.name || (s.lang ? s.lang.toUpperCase() : `Track ${s.index}`),
        lang: lang.iso2,
        source: 'embedded',
        detail: `embedded · ${s.codec}`,
      });
    }
  } catch { /* a probe failure just means no embedded tracks are listed */ }
  return tracks;
}

// ─── online search (OpenSubtitles) ──────────────────────────────────

const OS_HEADERS = { 'X-User-Agent': 'TemporaryUserAgent', 'User-Agent': 'TemporaryUserAgent' };
const searchCache = new Map<string, { time: number; tracks: SubtitleTrack[] }>();

export async function searchOnline(q: OnlineQuery): Promise<SubtitleTrack[]> {
  const langs = (q.languages.length ? q.languages : ['en']).flatMap(iso2To3);
  if (langs.length === 0) langs.push('eng');
  const lang = langs.join(',');

  let route: string;
  // The service wants the id zero-padded to 7 digits (older films: tt0111161). Unpadded ids get a redirect to a broken host.
  const digits = (q.imdbId || '').replace(/^tt/, '').replace(/\D/g, '');
  const imdb = digits ? digits.padStart(7, '0') : '';
  if (imdb && q.season && q.episode) route = `episode-${q.episode}/imdbid-${imdb}/season-${q.season}/sublanguageid-${lang}`;
  else if (imdb) route = `imdbid-${imdb}/sublanguageid-${lang}`;
  else if (q.title) {
    const query = encodeURIComponent(`${q.title}${q.year ? ' ' + q.year : ''}`.toLowerCase());
    route = `${q.season && q.episode ? `episode-${q.episode}/` : ''}query-${query}${q.season && q.episode ? `/season-${q.season}` : ''}/sublanguageid-${lang}`;
  } else return [];

  const hit = searchCache.get(route);
  if (hit && Date.now() - hit.time < 10 * 60 * 1000) return hit.tracks;

  const res = await resilientFetch(`https://rest.opensubtitles.org/search/${route}`, { headers: OS_HEADERS, timeoutMs: 15000 });
  if (res.status === 429) throw new Error('OpenSubtitles is rate limiting requests. Try again in a minute.');
  if (!res.ok) throw new Error(`Subtitle search failed (HTTP ${res.status})`);
  const list = (await res.json()) as any[];

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

function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'subtitles');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── loading a track ────────────────────────────────────────────────

export async function loadTrack(id: string): Promise<{ label: string; vtt: string }> {
  if (id.startsWith('file:')) {
    const file = id.slice(5);
    return { label: path.basename(file), vtt: await toVtt(fs.readFileSync(file), path.extname(file)) };
  }

  if (id.startsWith('emb:')) {
    const [file, idx] = id.slice(4).split('|');
    const cached = path.join(cacheDir(), crypto.createHash('sha1').update(id).digest('hex') + '.vtt');
    if (fs.existsSync(cached)) return { label: 'Embedded', vtt: fs.readFileSync(cached, 'utf8') };
    const out = await runFfmpeg(['-i', file, '-map', `0:${Number(idx)}`, '-f', 'webvtt', 'pipe:1'], 300000);
    const vtt = decodeSubtitle(out);
    fs.writeFileSync(cached, vtt, 'utf8');
    return { label: 'Embedded', vtt };
  }

  if (id.startsWith('os:')) {
    const meta = JSON.parse(id.slice(3)) as { link: string; enc: string; fmt: string; name: string };
    const cached = path.join(cacheDir(), crypto.createHash('sha1').update(meta.link).digest('hex') + '.vtt');
    if (fs.existsSync(cached)) return { label: meta.name, vtt: fs.readFileSync(cached, 'utf8') };
    const res = await resilientFetch(meta.link, { headers: OS_HEADERS, timeoutMs: 20000 });
    if (!res.ok) throw new Error(`Subtitle download failed (HTTP ${res.status})`);
    let buf: Buffer = Buffer.from(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const vtt = await toVtt(buf, '.' + meta.fmt, meta.enc);
    fs.writeFileSync(cached, vtt, 'utf8');
    return { label: meta.name, vtt };
  }

  throw new Error('Unknown subtitle source');
}

export async function pickSubtitleFile(win: BrowserWindow | null): Promise<{ label: string; vtt: string } | null> {
  const r = await dialog.showOpenDialog(win!, {
    title: 'Choose a subtitle file',
    properties: ['openFile'],
    filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub', 'smi', 'sbv'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const file = r.filePaths[0];
  return { label: path.basename(file), vtt: await toVtt(fs.readFileSync(file), path.extname(file)) };
}

/** Saves the most downloaded online subtitle next to a freshly downloaded video (e.g. Movie.en.vtt). */
export async function saveSubtitleBesideVideo(videoPath: string, q: Omit<OnlineQuery, 'languages'>, lang: string): Promise<string | null> {
  try {
    const dir = path.dirname(videoPath);
    const base = path.basename(videoPath, path.extname(videoPath));
    const dest = path.join(dir, `${base}.${lang}.vtt`);
    if (fs.existsSync(dest)) return dest;
    const results = await searchOnline({ ...q, languages: [lang] });
    if (!results.length) return null;
    const { vtt } = await loadTrack(results[0].id);
    if (!vtt || vtt.length < 40) return null;
    fs.writeFileSync(dest, vtt, 'utf8');
    return dest;
  } catch (err) {
    console.error('[subtitles] could not save a subtitle for the download:', err instanceof Error ? err.message : err);
    return null;
  }
}
