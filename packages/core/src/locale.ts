// locale bootstrap helpers (SSR-safe)
export interface ResolveLocaleOptions {
  supported: string[];
  fallback?: string;
  storageKey?: string | false;
}

const DEFAULT_KEY = 'verbaly-locale';

export function resolveLocale(options: ResolveLocaleOptions): string {
  const { supported, fallback = supported[0] ?? 'en', storageKey = DEFAULT_KEY } = options;

  if (storageKey) {
    const stored = getStorage()?.getItem(storageKey);
    if (stored && supported.includes(stored)) return stored;
  }

  for (const lang of preferredLanguages()) {
    if (supported.includes(lang)) return lang;
    const base = lang.split('-')[0]!;
    if (supported.includes(base)) return base;
  }

  return fallback;
}

export function persistLocale(locale: string, storageKey: string | false = DEFAULT_KEY): void {
  if (storageKey) getStorage()?.setItem(storageKey, locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

function preferredLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked storage (privacy mode)
  }
}
