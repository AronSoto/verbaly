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
    const match = stored && matchSupported(stored, supported);
    if (match) return match;
  }

  for (const lang of preferredLanguages()) {
    const match = matchSupported(lang, supported);
    if (match) return match;
  }

  return fallback;
}

// exact, then BCP-47 base (es-PE → es)
function matchSupported(lang: string, supported: string[]): string | undefined {
  if (supported.includes(lang)) return lang;
  const base = lang.split('-')[0]!;
  return supported.includes(base) ? base : undefined;
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
