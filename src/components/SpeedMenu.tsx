import { useState, useRef, useEffect } from 'react';
import { Icon } from './Icon';

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const label = (s: number) => (s === 1 ? 'Normal' : `${s}×`);

/** Pill button that opens a styled speed list (replaces the plain browser dropdown). */
export function SpeedMenu({ value, onChange, onOpenChange }: { value: number; onChange: (v: number) => void; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const set = (o: boolean) => { setOpen(o); onOpenChange?.(o); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) set(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); set(false); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={wrap} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button className="speed-pill" title="Playback speed" aria-haspopup="listbox" aria-expanded={open} onClick={() => set(!open)}>
        {value}× <Icon name="chevronRight" size={14} style={{ transform: open ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 200ms' }} />
      </button>
      {open && (
        <div className="speed-menu" role="listbox">
          <div className="cc-menu-title">Playback speed</div>
          {SPEEDS.map(s => (
            <button key={s} role="option" aria-selected={s === value} className={`cc-row ${s === value ? 'active' : ''}`} onClick={() => { onChange(s); set(false); }}>
              <span className="cc-check">{s === value && <Icon name="check" size={14} />}</span>
              <span className="cc-row-label">{label(s)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
