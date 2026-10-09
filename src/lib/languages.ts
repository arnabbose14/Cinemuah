import { useEffect, useState } from 'react';

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'ml', label: 'Malayalam' },
  { code: 'kn', label: 'Kannada' },
  { code: 'mr', label: 'Marathi' },
  { code: 'pa', label: 'Punjabi' },
  { code: 'ur', label: 'Urdu' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'pl', label: 'Polish' },
  { code: 'nl', label: 'Dutch' },
  { code: 'sv', label: 'Swedish' },
  { code: 'da', label: 'Danish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'fa', label: 'Persian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'th', label: 'Thai' },
];

// YTS uses a few non-standard codes
const ALIASES: Record<string, string> = { cn: 'zh', tl: 'fil' };

export const normLang = (code: string): string => {
  const base = (code || '').toLowerCase().split('-')[0];
  return ALIASES[base] || base;
};

// TVMaze reports languages by English name
const NAME_TO_CODE: Record<string, string> = Object.fromEntries(LANGUAGES.map(l => [l.label.toLowerCase(), l.code]));

/** Series language filter. Shows with no language listed are kept. */
export const matchesLanguageName = (name: string | null | undefined, selected: string[]): boolean => {
  if (selected.length === 0 || !name) return true;
  const code = NAME_TO_CODE[name.toLowerCase()];
  return code ? selected.includes(code) : false;
};

/** An empty selection means "all languages". */
export const matchesLanguages = (movieLanguage: string, selected: string[]): boolean =>
  selected.length === 0 || selected.includes(normLang(movieLanguage));

export const parseLanguages = (raw: string | null | undefined): string[] =>
  (raw || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Shared between pages so the preference is applied from the first render after it has loaded once
let cached: string[] | null = null;

export function setLanguagesCache(languages: string[]) {
  cached = languages;
}

/** The user's preferred movie languages (from Settings). `ready` is false until they have loaded. */
export function useLanguages(): { languages: string[]; ready: boolean } {
  const [languages, setLanguages] = useState<string[]>(cached ?? []);
  const [ready, setReady] = useState(cached !== null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.settings.get('languages')
      .then(raw => {
        const parsed = parseLanguages(raw);
        cached = parsed;
        if (!cancelled) { setLanguages(parsed); setReady(true); }
      })
      .catch(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  return { languages, ready };
}
