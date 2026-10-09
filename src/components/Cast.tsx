import { useState, useEffect, useRef, useCallback } from 'react';
import type { CastDevice, CastStatus } from '@/types';
import { formatSeconds } from '@/types';
import type { Cue } from './Captions';
import { Icon } from './Icon';

const clean = (e: unknown) =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const vttTime = (t: number) => {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};
export const cuesToVtt = (cues: Cue[], delay: number) =>
  'WEBVTT\n\n' + cues.map(c => `${vttTime(c.start + delay)} --> ${vttTime(c.end + delay)}\n${c.html}\n`).join('\n');

/** "media/12" or "torrent/<hash>/0" from a loopback media URL, or null when the video can't be cast. */
export const castTargetOf = (url: string): string | null =>
  /^(?:https?:\/\/[^/]+)?\/(media\/\d+|torrent\/[0-9a-fA-F]{40}\/\d+)/.exec(url)?.[1] ?? null;

export interface CastState {
  supported: boolean;
  devices: CastDevice[];
  scanning: boolean;
  status: CastStatus | null;
  casting: boolean;
  starting: string | null;
  error: string | null;
  scan: () => void;
  start: (device: CastDevice) => Promise<void>;
  control: (action: 'play' | 'pause' | 'seek' | 'volume' | 'mute', value?: number) => void;
  /** Ends the cast and returns where the TV had got to (seconds). */
  stop: () => Promise<number>;
}

interface Options {
  target: string | null;
  title: string;
  getPosition: () => number;
  cues: Cue[];
  delay: number;
  /** Called when the cast begins, so local playback can be paused. */
  onStarted: () => void;
}

export function useCast({ target, title, getPosition, cues, delay, onStarted }: Options): CastState {
  const api = window.electronAPI.cast;
  const supported = !!api && !!target;
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<CastStatus | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<CastStatus | null>(null);
  statusRef.current = status;
  const casting = !!status?.active;

  const scan = useCallback(() => {
    if (!api) return;
    setScanning(true); setError(null);
    api.devices().then(setDevices).catch(e => setError(clean(e))).finally(() => setScanning(false));
  }, [api]);

  // Poll the TV while a cast is running
  useEffect(() => {
    if (!api || !casting) return;
    const timer = setInterval(() => {
      api.status().then(s => { if (s.active) setStatus(s); else setStatus(null); }).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [api, casting]);

  // Never leave a TV playing after the player goes away
  useEffect(() => () => { if (statusRef.current?.active) window.electronAPI.cast?.stop().catch(() => undefined); }, []);

  const start = useCallback(async (device: CastDevice) => {
    if (!api || !target) return;
    setStarting(device.id); setError(null);
    try {
      const r = await api.start({
        deviceId: device.id, target, title, start: getPosition(),
        vtt: cues.length > 0 ? cuesToVtt(cues, delay) : undefined,
      });
      onStarted();
      setStatus({
        active: true, state: 'loading', position: getPosition(), duration: r.duration, volume: 0.5, muted: false,
        deviceName: r.deviceName, mode: r.mode,
      });
    } catch (e) {
      setError(clean(e));
    } finally {
      setStarting(null);
    }
  }, [api, target, title, getPosition, cues, delay, onStarted]);

  const control: CastState['control'] = useCallback((action, value) => {
    if (!api) return;
    // optimistic update so the panel feels instant
    setStatus(s => {
      if (!s) return s;
      if (action === 'play') return { ...s, state: 'playing' };
      if (action === 'pause') return { ...s, state: 'paused' };
      if (action === 'seek') return { ...s, position: value ?? s.position, state: s.mode === 'transcode' ? 'loading' : s.state };
      if (action === 'volume') return { ...s, volume: value ?? s.volume };
      if (action === 'mute') return { ...s, muted: !s.muted };
      return s;
    });
    api.control(action, value).catch(e => setError(clean(e)));
  }, [api]);

  const stop = useCallback(async () => {
    const pos = statusRef.current?.position ?? 0;
    setStatus(null);
    await api?.stop().catch(() => undefined);
    return pos;
  }, [api]);

  return { supported, devices, scanning, status, casting, starting, error, scan, start, control, stop };
}

// ─── Button + device picker ─────────────────────────────────────────

export function CastMenu({ cast, onOpenChange, onStop }: { cast: CastState; onOpenChange?: (open: boolean) => void; onStop: () => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const set = (o: boolean) => { setOpen(o); onOpenChange?.(o); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) set(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!cast.supported) return null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        className="icon-btn"
        style={{ color: cast.casting ? 'var(--accent)' : 'white' }}
        title={cast.casting ? `Casting to ${cast.status?.deviceName}` : 'Cast to a TV'}
        onClick={() => { const next = !open; set(next); if (next && !cast.casting) cast.scan(); }}
      >
        <Icon name="cast" size={22} />
      </button>

      {open && (
        <div className="cc-menu" style={{ width: 340 }}>
          <div className="cc-menu-title">Cast to a TV</div>

          {cast.casting && (
            <>
              <div className="cc-hint" style={{ color: '#fff' }}>Casting to <b>{cast.status?.deviceName}</b></div>
              <div className="cc-footer"><button className="btn btn-secondary btn-sm" onClick={() => { set(false); onStop(); }}>Stop casting</button></div>
            </>
          )}

          {!cast.casting && (
            <>
              {cast.devices.map(d => (
                <button key={d.id} className="cc-row" disabled={!!cast.starting} onClick={() => { cast.start(d).then(() => set(false)); }}>
                  <span className="cc-check"><Icon name="cast" size={16} /></span>
                  <span className="cc-row-main">
                    <span className="cc-row-label">{d.name}</span>
                    <span className="cc-row-detail">{d.kind === 'chromecast' ? 'Chromecast' : 'DLNA / Smart TV'}{cast.starting === d.id ? ' · connecting...' : ''}</span>
                  </span>
                </button>
              ))}

              {cast.scanning && <div className="cc-hint">Looking for TVs on your network...</div>}
              {!cast.scanning && cast.devices.length === 0 && !cast.error && (
                <div className="cc-hint">No TVs found. Make sure the TV is on and connected to the same Wi-Fi or network as this computer.</div>
              )}
              {cast.error && <div className="cc-error"><Icon name="warning" size={14} /> {cast.error}</div>}

              <div className="cc-footer">
                <button className="btn btn-ghost btn-sm" disabled={cast.scanning} onClick={cast.scan}><Icon name="refresh" size={14} /> Search again</button>
              </div>
              <div className="cc-hint" style={{ fontSize: 11 }}>If nothing shows up, allow Cinemuah through the Windows firewall for private networks.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Full-player panel while casting ────────────────────────────────

const STATE_LABEL: Record<CastStatus['state'], string> = {
  loading: 'Connecting to the TV...', buffering: 'Buffering...', playing: 'Playing', paused: 'Paused', idle: 'Stopped', ended: 'Finished',
};

export function CastPanel({ cast, title, onStop, onBack }: { cast: CastState; title: string; onStop: () => void; onBack: () => void }) {
  const s = cast.status;
  const [drag, setDrag] = useState<number | null>(null);
  if (!s) return null;
  const pos = drag ?? s.position;
  const pct = s.duration > 0 ? Math.min(100, (pos / s.duration) * 100) : 0;
  const playing = s.state === 'playing' || s.state === 'buffering' || s.state === 'loading';

  const seekFromEvent = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!(s.duration > 0)) return;
    const r = e.currentTarget.getBoundingClientRect();
    cast.control('seek', Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * s.duration);
  };

  return (
    <div className="cast-panel" onClick={e => e.stopPropagation()}>
      <button className="icon-btn cast-panel-back" onClick={onBack} title="Close (Esc)"><Icon name="back" size={26} /></button>
      <div className="cast-panel-body">
        <div className="cast-panel-icon"><Icon name="cast" size={64} /></div>
        <div className="cast-panel-device">Casting to {s.deviceName}</div>
        <h2 className="cast-panel-title">{title}</h2>
        <div className="cast-panel-state">{cast.error ? cast.error : STATE_LABEL[s.state]}{s.mode === 'transcode' && s.state === 'loading' ? ' (converting for your TV)' : ''}</div>

        <div className="cast-panel-seek" onClick={seekFromEvent} onMouseMove={e => { if (s.duration > 0) { const r = e.currentTarget.getBoundingClientRect(); setDrag(((e.clientX - r.left) / r.width) * s.duration); } }} onMouseLeave={() => setDrag(null)}>
          <div className="seek-bar"><div className="seek-bar-fill" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="cast-panel-time">{formatSeconds(s.position)} / {formatSeconds(s.duration)}</div>

        <div className="cast-panel-controls">
          <button className="icon-btn" style={{ color: '#fff' }} onClick={() => cast.control('seek', s.position - 10)} title="Back 10s"><Icon name="skipBack" size={30} /></button>
          <button className="cast-panel-play" onClick={() => cast.control(playing ? 'pause' : 'play')} title={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={32} />
          </button>
          <button className="icon-btn" style={{ color: '#fff' }} onClick={() => cast.control('seek', s.position + 10)} title="Forward 10s"><Icon name="skipForward" size={30} /></button>
        </div>

        <div className="cast-panel-volume">
          <button className="icon-btn" style={{ color: '#fff' }} onClick={() => cast.control('mute')} title="Mute">
            <Icon name={s.muted || s.volume === 0 ? 'volumeMute' : s.volume < 0.5 ? 'volumeLow' : 'volumeHigh'} />
          </button>
          <input type="range" className="volume-slider" min="0" max="1" step="0.05" value={s.muted ? 0 : s.volume}
            onChange={e => cast.control('volume', parseFloat(e.target.value))} style={{ width: 160, opacity: 1 }} />
        </div>

        <button className="btn btn-secondary" onClick={onStop}>Stop casting and watch here</button>
      </div>
    </div>
  );
}
