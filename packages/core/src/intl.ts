const CACHE_CAP = 200; // dynamic locales/options can't grow unbounded

const nfCache = new Map<string, Intl.NumberFormat>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const prCache = new Map<string, Intl.PluralRules>();
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
const lfCache = new Map<string, Intl.ListFormat>();

function cached<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
    hit = make();
    cache.set(key, hit);
  }
  return hit;
}

export function numberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = locale + (options ? JSON.stringify(options) : '');
  return cached(nfCache, key, () => new Intl.NumberFormat(locale, options));
}

export function dateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = locale + (options ? JSON.stringify(options) : '');
  return cached(dtfCache, key, () => new Intl.DateTimeFormat(locale, options));
}

export function pluralRules(
  locale: string,
  type: Intl.PluralRuleType = 'cardinal',
): Intl.PluralRules {
  return cached(prCache, locale + type, () => new Intl.PluralRules(locale, { type }));
}

export function relativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  return cached(rtfCache, locale, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
}

export function listFormat(locale: string, type: Intl.ListFormatType): Intl.ListFormat {
  return cached(lfCache, locale + type, () => new Intl.ListFormat(locale, { type }));
}
