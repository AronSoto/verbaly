import { displayNames } from './intl';
import type { Verbaly } from './types';

export interface ResolveLocaleOptions {
  supported: string[];
  fallback?: string;
  storageKey?: string | false;
}

// shared identity: localStorage key (browser) + cookie name (SSR integrations)
export const LOCALE_STORAGE_KEY = 'verbaly-locale';

// zh-Hant-TW → [zh-Hant-TW, zh-Hant, zh]
export function narrowLocales(lang: string): string[] {
  const out: string[] = [];
  const parts = lang.split('-');
  while (parts.length > 0) {
    out.push(parts.join('-'));
    parts.pop();
  }
  return out;
}

// fallback tables for engines without Intl.Locale getTextInfo (Firefox)
const RTL_SCRIPTS = /^(Arab|Aran|Hebr|Thaa|Nkoo|Syrc|Samr|Mand|Adlm|Rohg|Yezi)$/;
const RTL_LANGS = /^(ar|he|fa|ur|ps|sd|ug|yi|dv|ckb)$/;

interface TextInfoLocale extends Intl.Locale {
  getTextInfo?(): { direction?: string };
  textInfo?: { direction?: string };
}

export function localeDirection(locale: string): 'ltr' | 'rtl' {
  try {
    const loc = new Intl.Locale(locale) as TextInfoLocale;
    const direction = (loc.getTextInfo?.() ?? loc.textInfo)?.direction;
    if (direction === 'rtl' || direction === 'ltr') return direction;
    const script = loc.script ?? loc.maximize().script;
    if (script) return RTL_SCRIPTS.test(script) ? 'rtl' : 'ltr';
    return RTL_LANGS.test(loc.language) ? 'rtl' : 'ltr';
  } catch {
    // malformed tag: best effort on the primary subtag, never throw
    return RTL_LANGS.test(locale.split('-')[0]!.toLowerCase()) ? 'rtl' : 'ltr';
  }
}

// localized language name for locale switchers; defaults to the endonym
export function localeName(locale: string, displayIn: string = locale): string {
  try {
    return displayNames(displayIn).of(locale) ?? locale;
  } catch {
    return locale; // unknown tag or missing Intl data: the code beats a crash
  }
}

export function resolveLocale(options: ResolveLocaleOptions): string {
  const { supported, fallback = supported[0] ?? 'en', storageKey = LOCALE_STORAGE_KEY } = options;

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

// exact, then progressive BCP-47 narrowing (zh-Hant-TW → zh-Hant → zh)
function matchSupported(lang: string, supported: string[]): string | undefined {
  for (const candidate of narrowLocales(lang)) {
    if (supported.includes(candidate)) return candidate;
  }
  return undefined;
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
  // stable sort: ties keep header order
  ranges.sort((a, b) => b.q - a.q);

  for (const { tag } of ranges) {
    const match = matchSupportedLoose(tag, supported);
    if (match) return match;
  }
  return fallback;
}

// case-insensitive matchSupported (headers arrive as en-US; configs as en)
function matchSupportedLoose(lang: string, supported: string[]): string | undefined {
  for (const candidate of narrowLocales(lang.toLowerCase())) {
    const match = supported.find((s) => s.toLowerCase() === candidate);
    if (match) return match;
  }
  return undefined;
}

// per-request negotiation shared by SSR integrations: cookie value → Accept-Language → fallback
export interface RequestLocaleOptions {
  supported: string[];
  cookie?: string | null;
  header?: string | null;
  fallback?: string;
}

export function resolveRequestLocale(options: RequestLocaleOptions): string {
  const { supported, cookie, header, fallback = supported[0] ?? 'en' } = options;
  if (cookie) {
    // '' sentinel = no match → fall through to the header
    const match = negotiateLocale(cookie, supported, '');
    if (match) return match;
  }
  return negotiateLocale(header, supported, fallback);
}

export interface SwitchLocaleOptions {
  cookie?: string | false;
  maxAge?: number;
}

const YEAR = 31536000;

// client-side switch shared by SSR integrations: catalog first (no flash), then locale, then persistence
export async function switchLocale(
  instance: Pick<Verbaly, 'loadLocale' | 'setLocale'>,
  locale: string,
  options: SwitchLocaleOptions = {},
): Promise<void> {
  const { cookie = LOCALE_STORAGE_KEY, maxAge = YEAR } = options;
  await instance.loadLocale(locale);
  instance.setLocale(locale);
  if (typeof document === 'undefined') return; // SSR-safe no-op
  if (cookie) {
    document.cookie = `${cookie}=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; samesite=lax`;
  }
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDirection(locale);
}

export function persistLocale(
  locale: string,
  storageKey: string | false = LOCALE_STORAGE_KEY,
): void {
  if (storageKey) getStorage()?.setItem(storageKey, locale);
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirection(locale);
  }
}

function preferredLanguages(): readonly string[] {
  // require document: Node 21+ has a global navigator whose language is the OS, not a user
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
