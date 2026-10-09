import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Profile } from '@/types';
import { setKidsMode } from '@/lib/kids';
import { refreshWatched } from '@/lib/watched';
import { refreshFollows } from '@/lib/follows';

interface ProfileContextValue {
  /** False where the platform has no profile support (e.g. the Android build). */
  supported: boolean;
  profiles: Profile[];
  active: Profile | null;
  /** Changes whenever the active profile changes, so pages can reload their data. */
  version: number;
  pickerOpen: boolean;
  /** The picker is blocking (start of the app) rather than a voluntary switch. */
  pickerRequired: boolean;
  /** Starts in manage mode when `manage` is true. */
  pickerManage: boolean;
  openPicker: (manage?: boolean) => void;
  closePicker: () => void;
  switchTo: (id: number, pin?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<ProfileContextValue>({
  supported: false, profiles: [], active: null, version: 0, pickerOpen: false, pickerRequired: false, pickerManage: false,
  openPicker: () => undefined, closePicker: () => undefined, switchTo: async () => undefined, refresh: async () => undefined,
});

export const useProfile = () => useContext(Ctx);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const api = window.electronAPI.profiles;
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [active, setActive] = useState<Profile | null>(null);
  const [version, setVersion] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRequired, setPickerRequired] = useState(false);
  const [pickerManage, setPickerManage] = useState(false);

  const refresh = useCallback(async () => {
    if (!api) return;
    const [list, current] = await Promise.all([api.list(), api.active()]);
    setProfiles(list);
    setActive(current);
    setKidsMode(current.kids);
  }, [api]);

  // Several profiles: ask who is watching at launch
  useEffect(() => {
    if (!api) return;
    (async () => {
      await refresh();
      const list = await api.list();
      if (list.length > 1) { setPickerRequired(true); setPickerOpen(true); }
    })().catch(() => undefined);
  }, [api, refresh]);

  const switchTo = useCallback(async (id: number, pin?: string) => {
    if (!api) return;
    const p = await api.switch(id, pin);
    setActive(p);
    setKidsMode(p.kids);
    await Promise.all([refreshWatched(), refreshFollows()]);
    setVersion(v => v + 1);
    setPickerOpen(false);
    setPickerRequired(false);
  }, [api]);

  return (
    <Ctx.Provider value={{
      supported: !!api, profiles, active, version, pickerOpen, pickerRequired,
      pickerManage,
      openPicker: (manage = false) => { setPickerManage(manage); setPickerOpen(true); },
      closePicker: () => { if (!pickerRequired) setPickerOpen(false); },
      switchTo, refresh,
    }}>
      {children}
    </Ctx.Provider>
  );
}
