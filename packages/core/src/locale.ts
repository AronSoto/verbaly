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

// server-side Accept-Language negotiation (q-values, case-insensitive, BCP-47 base)
export function negotiateLocale(
  header: string | null | undefined,
  supported: string[],
  fallback: string = supported[0] ?? 'en',
): string {
  if (!header) return fallback;

  const ranges: { tag: string; q: number }[] = [];
  for (const part of header.split(',')) {
    const [rawTag, ...params] = part.trim().split(';');
    const tag = rawTag?.trim();
    if (!tag || tag === '*') continue;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.split('=');
      if (name?.trim().toLowerCase() === 'q') {
        const parsed = Number(value?.trim());
        q = Number.isFinite(parsed) ? parsed : 1;
      }
    }
    if (q > 0) ranges.push({ tag, q });
  }
  // stable sort — ties keep header order
  ranges.sort((a, b) => b.q - a.q);

  for (const { tag } of ranges) {
    const match = matchSupportedLoose(tag, supported);
    if (match) return match;
  }
  return fallback;
}

// case-insensitive matchSupported (headers arrive as en-US; configs as en)
function matchSupportedLoose(lang: string, supported: string[]): string | undefined {
  const lower = lang.toLowerCase();
  const exact = supported.find((s) => s.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('-')[0]!;
  return supported.find((s) => s.toLowerCase() === base);
}

export function persistLocale(locale: string, storageKey: string | false = DEFAULT_KEY): void {
  if (storageKey) getStorage()?.setItem(storageKey, locale);
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

function preferredLanguages(): readonly string[] {
  // require document — Node 21+ has a global navigator whose language is the OS, not a user
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // blocked storage (privacy mode)
  }
}
