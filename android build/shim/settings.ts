// Settings live in localStorage (same keys the desktop app stores in its database).
const PREFIX = 'cm:setting:';

const DEFAULTS: Record<string, string> = {
  moviesFolder: 'Movies/Cinemuah (on this phone)',
};

export function getSetting(key: string): string {
  const v = localStorage.getItem(PREFIX + key);
  return v ?? DEFAULTS[key] ?? '';
}

export function setSetting(key: string, value: string) {
  localStorage.setItem(PREFIX + key, value);
}
