import { useState, useEffect } from 'react';
import type { Profile } from '@/types';
import { useProfile } from '@/contexts/ProfileContext';
import { useToast } from '@/contexts/ToastContext';
import { Icon } from './Icon';

const COLORS = ['#e50914', '#0071eb', '#46d369', '#f5a623', '#b81d8f', '#00b5ad'];

const clean = (err: unknown) =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong';

// Drawn faces (plain SVG, no emoji): eyes + mouth variants on a coloured tile
const FACE_COUNT = 8;
function Face({ index }: { index: number }) {
  const w = { stroke: '#fff', strokeWidth: 5, strokeLinecap: 'round' as const, fill: 'none' };
  const eyes = (y = 42) => (<><circle cx="35" cy={y} r="6" fill="#fff" /><circle cx="65" cy={y} r="6" fill="#fff" /></>);
  switch (index % FACE_COUNT) {
    case 0: return <>{eyes()}<path d="M30 62 Q50 82 70 62" {...w} /></>;                                           // happy
    case 1: return <><path d="M28 44 Q35 36 42 44" {...w} /><circle cx="65" cy="42" r="6" fill="#fff" /><path d="M30 62 Q50 82 70 62" {...w} /></>; // wink
    case 2: return <><rect x="22" y="34" width="24" height="15" rx="5" fill="#111" /><rect x="54" y="34" width="24" height="15" rx="5" fill="#111" /><path d="M46 40 H54" {...w} strokeWidth={3} /><path d="M32 64 Q50 78 68 64" {...w} /></>; // cool
    case 3: return <>{eyes()}<ellipse cx="50" cy="68" rx="8" ry="10" fill="#fff" /></>;                              // surprised
    case 4: return <><path d="M27 44 Q35 52 43 44" {...w} /><path d="M57 44 Q65 52 73 44" {...w} /><path d="M40 68 H60" {...w} /></>; // sleepy
    case 5: return <>{eyes()}<path d="M28 60 H72 Q70 80 50 80 Q30 80 28 60 Z" fill="#fff" /></>;                     // big grin
    case 6: return <><path d="M26 34 L44 38" {...w} strokeWidth={4} />{eyes(46)}<path d="M32 66 Q55 78 72 60" {...w} /></>; // smirk
    default: return <>{eyes(44)}<circle cx="24" cy="60" r="5" fill="rgba(255,255,255,0.45)" /><circle cx="76" cy="60" r="5" fill="rgba(255,255,255,0.45)" /><path d="M38 64 Q50 76 62 64" {...w} /></>; // cheeky
  }
}

export function Avatar({ profile, size = 40 }: { profile: Pick<Profile, 'color' | 'avatar' | 'name'>; size?: number }) {
  return (
    <div className="profile-avatar" style={{ width: size, height: size, background: profile.color }} role="img" aria-label={profile.name}>
      <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><Face index={profile.avatar || 0} /></svg>
    </div>
  );
}

function PinPrompt({ profile, onSubmit, onCancel }: { profile: Profile; onSubmit: (pin: string) => Promise<void>; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (value: string) => {
    setBusy(true); setError('');
    try { await onSubmit(value); } catch (e) { setError(clean(e)); setPin(''); } finally { setBusy(false); }
  };
  return (
    <div className="profile-modal" onClick={e => e.stopPropagation()}>
      <Avatar profile={profile} size={64} />
      <h2 style={{ fontSize: 22, margin: '12px 0 4px' }}>{profile.name}</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>Enter the 4 digit PIN</p>
      <input
        autoFocus type="password" inputMode="numeric" maxLength={4} value={pin} disabled={busy}
        className="settings-input pin-input"
        onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setPin(v); if (v.length === 4) submit(v); }}
      />
      {error && <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function Editor({ profile, canDelete, onDone }: { profile: Profile | null; canDelete: boolean; onDone: () => void }) {
  const api = window.electronAPI.profiles!;
  const { showToast } = useToast();
  const { refresh } = useProfile();
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? COLORS[0]);
  const [avatar, setAvatar] = useState(profile?.avatar ?? 0);
  const [kids, setKids] = useState(profile?.kids ?? false);
  const [pin, setPin] = useState('');
  const [removePin, setRemovePin] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (pin && !/^\d{4}$/.test(pin)) { showToast('The PIN must be 4 digits', 'error'); return; }
    setBusy(true);
    try {
      if (profile) {
        await api.update(profile.id, { name, color, avatar, kids, ...(pin ? { pin } : removePin ? { pin: null } : {}) });
      } else {
        await api.create({ name, color, avatar, kids, pin: pin || undefined });
      }
      await refresh();
      onDone();
    } catch (e) { showToast(clean(e), 'error'); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!profile || !window.confirm(`Delete ${profile.name}? Their history, playlists and My List are removed too.`)) return;
    try { await api.delete(profile.id); await refresh(); onDone(); } catch (e) { showToast(clean(e), 'error'); }
  };

  return (
    <div className="profile-modal" style={{ width: 420, textAlign: 'left' }} onClick={e => e.stopPropagation()}>
      <h2 style={{ fontSize: 22, marginBottom: 16 }}>{profile ? 'Edit profile' : 'Add profile'}</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <Avatar profile={{ name: name || 'Profile', color, avatar }} size={64} />
        <input className="settings-input" style={{ flex: 1 }} autoFocus value={name} maxLength={24} placeholder="Name" onChange={e => setName(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {Array.from({ length: FACE_COUNT }, (_, i) => (
          <button key={i} onClick={() => setAvatar(i)} aria-label={`Face ${i + 1}`}
            style={{ padding: 0, background: 'none', border: avatar === i ? '3px solid #fff' : '3px solid transparent', borderRadius: 10, cursor: 'pointer' }}>
            <Avatar profile={{ name: 'Face', color, avatar: i }} size={44} />
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
            style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? '3px solid #fff' : '3px solid transparent', cursor: 'pointer' }} />
        ))}
      </div>
      <label className="profile-check">
        <input type="checkbox" checked={kids} onChange={e => setKids(e.target.checked)} />
        <span><b>Kids profile</b><br /><small>Only shows family-friendly titles (Family and Animation) and hides Settings.</small></span>
      </label>
      <div style={{ marginTop: 14 }}>
        <label className="settings-label">PIN to open this profile (optional)</label>
        <input className="settings-input pin-input" style={{ width: 140, textAlign: 'center' }} type="password" inputMode="numeric" maxLength={4}
          placeholder={profile?.hasPin && !removePin ? 'PIN set' : '4 digits'} value={pin} disabled={removePin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        {profile?.hasPin && (
          <label style={{ fontSize: 13, marginLeft: 12, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={removePin} onChange={e => { setRemovePin(e.target.checked); setPin(''); }} /> Remove PIN
          </label>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>Save</button>
        <button className="btn btn-ghost" onClick={onDone}>Cancel</button>
        {profile && canDelete && <button className="btn btn-ghost" style={{ marginLeft: 'auto' }} onClick={remove}><Icon name="trash" size={14} /> Delete</button>}
      </div>
    </div>
  );
}

/** "Who's watching?" — pick, protect and manage profiles. */
export function ProfilePicker() {
  const { profiles, active, pickerOpen, pickerRequired, pickerManage, closePicker, switchTo } = useProfile();
  const { showToast } = useToast();
  const [managing, setManaging] = useState(false);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);

  useEffect(() => { if (pickerOpen) { setManaging(pickerManage); setEditing(null); setPinFor(null); } }, [pickerOpen, pickerManage]);

  if (!pickerOpen) return null;

  const choose = async (p: Profile) => {
    if (managing) { setEditing(p); return; }
    if (p.hasPin && p.id !== active?.id) { setPinFor(p); return; }
    try { await switchTo(p.id); } catch (e) { showToast(clean(e), 'error'); }
  };

  return (
    <div className="profile-picker" onClick={closePicker}>
      {!pickerRequired && <button className="detail-close" onClick={closePicker} title="Close"><Icon name="close" /></button>}
      {pinFor ? (
        <PinPrompt profile={pinFor} onCancel={() => setPinFor(null)} onSubmit={async pin => { await switchTo(pinFor.id, pin); setPinFor(null); }} />
      ) : editing ? (
        <Editor profile={editing === 'new' ? null : editing} canDelete={profiles.length > 1} onDone={() => setEditing(null)} />
      ) : (
        <div onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 38, fontWeight: 800, marginBottom: 32 }}>{managing ? 'Manage profiles' : "Who's watching?"}</h1>
          <div className="profile-grid">
            {profiles.map(p => (
              <button key={p.id} className="profile-tile" onClick={() => choose(p)}>
                <div style={{ position: 'relative' }}>
                  <Avatar profile={p} size={120} />
                  {managing && <div className="profile-edit-badge"><Icon name="edit" size={34} /></div>}
                  {p.hasPin && !managing && <div className="profile-lock">PIN</div>}
                </div>
                <div className="profile-name">{p.name}{p.kids ? ' · Kids' : ''}</div>
                {p.id === active?.id && !managing && <div className="profile-current">Current</div>}
              </button>
            ))}
            {profiles.length < 6 && (
              <button className="profile-tile" onClick={() => setEditing('new')}>
                <div className="profile-avatar profile-add" style={{ width: 120, height: 120 }}><Icon name="plus" size={48} /></div>
                <div className="profile-name">Add profile</div>
              </button>
            )}
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 40 }} onClick={() => setManaging(m => !m)}>
            {managing ? 'Done' : 'Manage profiles'}
          </button>
        </div>
      )}
    </div>
  );
}
