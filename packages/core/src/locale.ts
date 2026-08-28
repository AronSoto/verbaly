import { displayNames } from './intl';
import type { Verbaly } from './types';
import { warnOnce } from './warn';

export interface ResolveLocaleOptions {
  supported: string[];
  fallback?: string;
  storageKey?: string | false;
  path?: string | false;
  base?: string;
}

export interface LocaleFromPathOptions {
  supported: string[];
  path?: string;
  base?: string;
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

// how the language shows in the url, the one decision every other url answer follows from
export type Routing = 'prefix-except-source' | 'no-prefix' | 'prefix-all';

interface LocalePathBase {
  supported: string[];
  path?: string;
  base?: string;
}

// sourceLocale is required exactly where it decides the answer, so the old silent default cannot
export type LocalePathOptions = LocalePathBase &
  (
    | { routing?: 'prefix-except-source'; sourceLocale: string }
    | { routing: 'no-prefix' | 'prefix-all'; sourceLocale?: string }
  );

// the inverse of what render writes: /es/docs → /pt/docs, under the routing mode you chose
export function localePath(locale: string, options: LocalePathOptions): string {
  const { supported } = options;
  const routing = options.routing ?? 'prefix-except-source';
  const full = options.path ?? currentPath() ?? '/';

  // the identity, so one switcher works in both modes: no-prefix changes the text, never the url
  if (routing === 'no-prefix') return full;

  const sourceLocale = options.sourceLocale;
  if (routing === 'prefix-except-source' && sourceLocale === undefined) {
    warnOnce('localePath needs sourceLocale: "prefix-except-source" prefixed every locale');
  }

  const base = normalizeBase(options.base);
  const cut = full.search(/[?#]/);
  const path = stripBase(cut < 0 ? full : full.slice(0, cut), base);
  const rest = cut < 0 ? '' : full.slice(cut);

  const segments = path.split('/').filter(Boolean);
  if (segments[0] && matchPathSegment(segments[0], supported)) segments.shift();
  if (routing === 'prefix-all' || locale !== sourceLocale) segments.unshift(locale);
  const trailing = segments.length && path.endsWith('/') ? '/' : '';
  return `${base}/${segments.join('/')}${trailing}${rest}`;
}

// which tree this page belongs to: a fact of the url, so it answers undefined instead of guessing
export function localeFromPath(options: LocaleFromPathOptions): string | undefined {
  const path = options.path ?? currentPath();
  if (path === undefined) return undefined;
  const segment = stripBase(path, normalizeBase(options.base)).split('/').find(Boolean);
  return segment ? matchPathSegment(segment, options.supported) : undefined;
}

export function resolveLocale(options: ResolveLocaleOptions): string {
  const { supported, fallback = supported[0] ?? 'en', storageKey = LOCALE_STORAGE_KEY } = options;

  // the document you are looking at wins: render put the page under that prefix already translated
  if (options.path !== false) {
    const match = localeFromPath({ supported, path: options.path, base: options.base });
    if (match) return match;
  }

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

// 'app', '/app' and '/app/' all read as '/app'; nothing means the site sits at the root
function normalizeBase(base: string | undefined): string {
  const trimmed = base?.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed ? `/${trimmed}` : '';
}

// the boundary check is what keeps base /app from swallowing /application
function stripBase(path: string, base: string): string {
  if (!base || !path.startsWith(base)) return path;
  const rest = path.slice(base.length);
  if (rest === '') return '/';
  return rest.startsWith('/') ? rest : path;
}

// language, optional script, optional region: what render writes, never a slug like pt-and-friends
const LOCALE_SEGMENT = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/i;

// a segment is narrowed only when it is shaped like a tag: a slug must never become a locale
function matchPathSegment(segment: string, supported: string[]): string | undefined {
  if (supported.includes(segment)) return segment;
  return LOCALE_SEGMENT.test(segment) ? matchSupported(segment, supported) : undefined;
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
  storageKey?: string | false;
  maxAge?: number;
  routing?: Routing;
  supported?: string[];
  sourceLocale?: string;
  base?: string;
  navigate?: (path: string) => void | Promise<void>;
}

const YEAR = 31536000;

// the whole switch, both modes: the url decides which half runs, never the caller
export async function switchLocale(
  instance: Pick<Verbaly, 'loadLocale' | 'setLocale'>,
  locale: string,
  options: SwitchLocaleOptions = {},
): Promise<void> {
  const { cookie = LOCALE_STORAGE_KEY, maxAge = YEAR } = options;
  // one name for one choice: naming the cookie names the storage too, or the two drift in silence
  const storageKey = options.storageKey ?? (cookie === false ? LOCALE_STORAGE_KEY : cookie);
  // absent means the caller never asked for url behavior, as every caller before this one did
  const routed = options.routing !== undefined && options.routing !== 'no-prefix';

  // the destination document is already in the target language, so its catalog is not this page's
  if (!routed) {
    await instance.loadLocale(locale);
    instance.setLocale(locale);
  }

  if (typeof document === 'undefined') return; // SSR-safe no-op
  // both channels: a server reads the cookie, render's pre-paint script reads storage
  if (cookie) {
    document.cookie = `${cookie}=${encodeURIComponent(locale)}; path=/; max-age=${maxAge}; samesite=lax`;
  }
  persistLocale(locale, storageKey);

  if (!routed) return;
  const target = localePath(locale, {
    supported: options.supported ?? [locale],
    sourceLocale: options.sourceLocale,
    base: options.base,
    routing: options.routing,
  } as LocalePathOptions);
  await (options.navigate ?? assign)(target);
}

// a full load is the floor, not the goal: a framework passes its own router and keeps the app alive
function assign(path: string): void {
  if (typeof location !== 'undefined') location.assign(path);
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

function currentPath(): string | undefined {
  // require document like every other browser check: a server has no page to read a prefix from
  return typeof document !== 'undefined' && typeof location !== 'undefined'
    ? location.pathname
    : undefined;
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
