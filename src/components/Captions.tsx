import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SubtitleTrack, SubtitleContext } from '@/types';
import { LANGUAGES } from '@/lib/languages';
import { Icon } from './Icon';

// ─── parsing ────────────────────────────────────────────────────────

export interface Cue { start: number; end: number; html: string }

function parseTime(s: string): number {
  const parts = s.trim().replace(',', '.').split(':').map(Number);
  if (parts.some(isNaN)) return NaN;
  while (parts.length < 3) parts.unshift(0);
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

const ALLOWED = /^<\/?(?:i|b|u)>$/i;

/** Keeps italic / bold / underline, drops every other tag, escapes the rest. */
function cueHtml(raw: string): string {
  const withoutTags = raw.replace(/<(?!\/?(?:i|b|u)\b)[^>]*>/gi, '');
  return withoutTags
    .split(/(<\/?(?:i|b|u)>)/gi)
    .map(part => (ALLOWED.test(part) ? part.toLowerCase() : part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')))
    .join('')
    .replace(/\n/g, '<br>');
}

/** Parses WebVTT or SRT text into time-sorted cues. */
export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTime(a);
    const end = parseTime((b || '').trim().split(/\s+/)[0]);
    const body = lines.slice(i + 1).join('\n').trim();
    if (isNaN(start) || isNaN(end) || !body) continue;
    cues.push({ start, end, html: cueHtml(body) });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** The cue to show at time `t`, or null. Cues are sorted by start; overlapping cues are rare, so scan back a few. */
export function cueAt(cues: Cue[], t: number): Cue | null {
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let i = idx; i >= 0 && i > idx - 4; i--) if (t < cues[i].end && t >= cues[i].start) return cues[i];
  return null;
}

// ─── state ──────────────────────────────────────────────────────────

export type CaptionSize = 's' | 'm' | 'l' | 'xl';
const SIZES: CaptionSize[] = ['s', 'm', 'l', 'xl'];
const SIZE_PX: Record<CaptionSize, number> = { s: 18, m: 24, l: 32, xl: 42 };

function preferredLanguage(): string {
  const saved = localStorage.getItem('cm_cc_lang');
  if (saved) return saved;
  const first = (localStorage.getItem('cm:setting:languages') || '').split(',')[0];   // optional: set by the Android shim
  return first || 'en';
}

export interface CaptionsState {
  supported: boolean;
  tracks: SubtitleTrack[];              // files and embedded tracks of this video
  online: SubtitleTrack[] | null;       // null = not searched yet
  active: { id: string; label: string } | null;
  cues: Cue[];
  loading: boolean;
  searching: boolean;
  error: string | null;
  delay: number;
  size: CaptionSize;
  lang: string;
  select: (track: SubtitleTrack) => Promise<void>;
  turnOff: () => void;
  toggle: () => void;
  search: (lang?: string) => Promise<void>;
  loadFile: () => Promise<void>;
  setDelay: (d: number) => void;
  setSize: (s: CaptionSize) => void;
  setLang: (l: string) => void;
}

export function useCaptions(context?: SubtitleContext): CaptionsState {
  const api = window.electronAPI.subtitles;
  const supported = !!api && !!context;
  const [tracks, setTracks] = useState<SubtitleTrack[]>([]);
  const [online, setOnline] = useState<SubtitleTrack[] | null>(null);
  const [active, setActive] = useState<{ id: string; label: string } | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [delay, setDelay] = useState(0);
  const [size, setSizeState] = useState<CaptionSize>(() => (SIZES.includes(localStorage.getItem('cm_cc_size') as CaptionSize) ? (localStorage.getItem('cm_cc_size') as CaptionSize) : 'm'));
  const [lang, setLangState] = useState(preferredLanguage);
  const lastTrack = useRef<SubtitleTrack | null>(null);
  // Captions on/off and language are remembered per show (or movie), on top of the global default
  const scope = context ? (context.imdbId || context.title) : '';
  const contextKey = context ? `${context.title}|${context.filePath || ''}|${context.season || ''}x${context.episode || ''}` : '';

  const clean = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong');

  const select = useCallback(async (track: SubtitleTrack) => {
    if (!api) return;
    setLoading(true); setError(null);
    try {
      const r = await api.load(track.id);
      const parsed = parseCues(r.vtt);
      if (parsed.length === 0) throw new Error('That subtitle file has no readable captions');
      setCues(parsed);
      setActive({ id: track.id, label: track.label });
      setDelay(0);
      lastTrack.current = track;
      localStorage.setItem('cm_cc_on', '1');
      if (scope) window.electronAPI.prefs?.set(scope, { subOn: true, ...(track.lang ? { subLang: track.lang } : {}) }).catch(() => undefined);
      if (track.lang) { localStorage.setItem('cm_cc_lang', track.lang); setLangState(track.lang); }
    } catch (e) {
      setError(clean(e));
    } finally {
      setLoading(false);
    }
  }, [api, scope]);

  const turnOff = useCallback(() => {
    setActive(null); setCues([]); setError(null);
    localStorage.setItem('cm_cc_on', '');
    if (scope) window.electronAPI.prefs?.set(scope, { subOn: false }).catch(() => undefined);
  }, [scope]);

  const toggle = useCallback(() => {
    if (active) turnOff();
    else if (lastTrack.current) select(lastTrack.current);
  }, [active, turnOff, select]);

  const search = useCallback(async (language?: string) => {
    if (!api || !context) return;
    const l = language || lang;
    setSearching(true); setError(null);
    try {
      const results = await api.search({
        imdbId: context.imdbId, season: context.season, episode: context.episode,
        title: context.title, year: context.year, languages: [l],
      });
      setOnline(results);
      if (results.length === 0) setError('No subtitles found for this title in that language');
    } catch (e) {
      setError(clean(e));
    } finally {
      setSearching(false);
    }
  }, [api, context, lang]);

  const loadFile = useCallback(async () => {
    if (!api) return;
    setError(null);
    try {
      const r = await api.pickFile();
      if (!r) return;
      const parsed = parseCues(r.vtt);
      if (parsed.length === 0) throw new Error('That file has no readable captions');
      setCues(parsed); setActive({ id: 'picked', label: r.label }); setDelay(0);
      lastTrack.current = null;
      localStorage.setItem('cm_cc_on', '1');
    } catch (e) {
      setError(clean(e));
    }
  }, [api]);

  const setSize = useCallback((s: CaptionSize) => { setSizeState(s); localStorage.setItem('cm_cc_size', s); }, []);
  const setLang = useCallback((l: string) => { setLangState(l); localStorage.setItem('cm_cc_lang', l); }, []);

  // New video: list its own tracks and, if captions were on last time, bring them back automatically
  useEffect(() => {
    setTracks([]); setOnline(null); setActive(null); setCues([]); setError(null); setDelay(0);
    lastTrack.current = null;
    if (!api || !context) return;
    let cancelled = false;
    (async () => {
      let own: SubtitleTrack[] = [];
      if (context.filePath) {
        try { own = await api.local(context.filePath); } catch { /* none */ }
        if (cancelled) return;
        setTracks(own);
      }
      let pref: Record<string, any> | null = null;
      try { pref = scope ? (await window.electronAPI.prefs?.get(scope)) ?? null : null; } catch { /* optional */ }
      if (cancelled) return;
      const on = pref && typeof pref.subOn === 'boolean' ? pref.subOn : localStorage.getItem('cm_cc_on') === '1';
      if (!on) return;
      const want = (pref?.subLang as string) || preferredLanguage();
      const local = own.find(t => t.lang === want) || own[0];
      if (local) { select(local); return; }
      // nothing bundled with the video: take the most downloaded online subtitle in the preferred language
      try {
        const results = await api.search({
          imdbId: context.imdbId, season: context.season, episode: context.episode, title: context.title, year: context.year, languages: [want],
        });
        if (cancelled) return;
        setOnline(results);
        if (results[0]) select(results[0]);
      } catch { /* the menu still lets the user search by hand */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  return { supported, tracks, online, active, cues, loading, searching, error, delay, size, lang, select, turnOff, toggle, search, loadFile, setDelay, setSize, setLang };
}

// ─── on-screen text ─────────────────────────────────────────────────

export function CaptionsOverlay({ cc, time, raised }: { cc: CaptionsState; time: number; raised: boolean }) {
  if (!cc.active) return null;
  const cue = cueAt(cc.cues, time - cc.delay);
  if (!cue) return null;
  return (
    <div className="cc-overlay" style={{ bottom: raised ? 118 : 56 }}>
      <span className="cc-text" style={{ fontSize: SIZE_PX[cc.size] }} dangerouslySetInnerHTML={{ __html: cue.html }} />
    </div>
  );
}

// ─── menu ───────────────────────────────────────────────────────────

export function CaptionsMenu({ cc, onOpenChange }: { cc: CaptionsState; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const setOpenBoth = (v: boolean) => { setOpen(v); onOpenChange(v); };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpenBoth(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Searching is automatic the first time the menu opens and nothing is bundled with the video
  useEffect(() => {
    if (open && cc.supported && cc.online === null && !cc.searching) cc.search();
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!cc.supported) return null;

  const row = (track: SubtitleTrack) => (
    <button key={track.id} className={`cc-row ${cc.active?.id === track.id ? 'active' : ''}`} onClick={() => cc.select(track)}>
      <span className="cc-check">{cc.active?.id === track.id && <Icon name="check" size={14} />}</span>
      <span className="cc-row-main">
        <span className="cc-row-label">{track.label}</span>
        {track.detail && <span className="cc-row-detail">{track.detail}</span>}
      </span>
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        className={`icon-btn ${cc.active ? 'cc-on' : ''}`}
        style={{ color: cc.active ? 'var(--accent)' : 'white' }}
        onClick={() => setOpenBoth(!open)}
        title="Captions (C)"
      >
        <Icon name="captions" size={24} />
      </button>

      {open && (
        <div className="cc-menu">
          <div className="cc-menu-title">Captions</div>

          <button className={`cc-row ${!cc.active ? 'active' : ''}`} onClick={() => cc.turnOff()}>
            <span className="cc-check">{!cc.active && <Icon name="check" size={14} />}</span>
            <span className="cc-row-main"><span className="cc-row-label">Off</span></span>
          </button>
          {cc.active?.id === 'picked' && (
            <button className="cc-row active"><span className="cc-check"><Icon name="check" size={14} /></span>
              <span className="cc-row-main"><span className="cc-row-label">{cc.active.label}</span><span className="cc-row-detail">from file</span></span>
            </button>
          )}

          {cc.tracks.length > 0 && <div className="cc-section">On this video</div>}
          {cc.tracks.map(row)}

          <div className="cc-section">Search online</div>
          <div className="cc-search">
            <select
              value={cc.lang}
              onChange={e => { cc.setLang(e.target.value); cc.search(e.target.value); }}
            >
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => cc.search()} disabled={cc.searching}>
              {cc.searching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {cc.online && cc.online.map(row)}

          {cc.error && <div className="cc-error"><Icon name="warning" size={14} /> {cc.error}</div>}
          {cc.loading && <div className="cc-hint">Loading captions...</div>}

          <div className="cc-footer">
            <button className="btn btn-ghost btn-sm" onClick={() => cc.loadFile()}><Icon name="folder" size={14} /> Load from file</button>
          </div>

          <div className="cc-controls">
            <span className="cc-control">
              Size
              <button className="cc-step" onClick={() => cc.setSize(SIZES[Math.max(0, SIZES.indexOf(cc.size) - 1)])} title="Smaller">A-</button>
              <b>{cc.size.toUpperCase()}</b>
              <button className="cc-step" onClick={() => cc.setSize(SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(cc.size) + 1)])} title="Larger">A+</button>
            </span>
            <span className="cc-control">
              Sync
              <button className="cc-step" onClick={() => cc.setDelay(Math.round((cc.delay - 0.5) * 10) / 10)} title="Show captions earlier">-0.5s</button>
              <b>{cc.delay > 0 ? '+' : ''}{cc.delay.toFixed(1)}s</b>
              <button className="cc-step" onClick={() => cc.setDelay(Math.round((cc.delay + 0.5) * 10) / 10)} title="Show captions later">+0.5s</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
