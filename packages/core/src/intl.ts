import { warnOnce } from './warn';

const CACHE_CAP = 200; // dynamic locales/options can't grow unbounded

const nfCache = new Map<string, Intl.NumberFormat>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const prCache = new Map<string, Intl.PluralRules>();
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
const lfCache = new Map<string, Intl.ListFormat>();
const dnCache = new Map<string, Intl.DisplayNames>();

function cached<T>(
  cache: Map<string, T>,
  key: string,
  locale: string,
  make: (tag?: string) => T,
): T {
  let hit = cache.get(key);
  if (!hit) {
    if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
    try {
      hit = make(locale);
    } catch {
      // a bad option throws on every retry, so only a tag Intl cannot read ever reaches the warn
      let tag: string | undefined = locale.replace(/_/g, '-');
      try {
        hit = make(tag);
      } catch {
        hit = make((tag = undefined));
      }
      warnOnce(
        `"${locale}" is not a locale tag, so Intl reads it as ${tag ?? 'its default locale'}`,
      );
    }
    cache.set(key, hit);
  }
  return hit;
}

export function numberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = locale + (options ? JSON.stringify(options) : '');
  return cached(nfCache, key, locale, (tag) => new Intl.NumberFormat(tag, options));
}

export function dateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = locale + (options ? JSON.stringify(options) : '');
  return cached(dtfCache, key, locale, (tag) => new Intl.DateTimeFormat(tag, options));
}

export function pluralRules(
  locale: string,
  type: Intl.PluralRuleType = 'cardinal',
): Intl.PluralRules {
  return cached(prCache, locale + type, locale, (tag) => new Intl.PluralRules(tag, { type }));
}

export function relativeTimeFormat(locale: string): Intl.RelativeTimeFormat {
  return cached(
    rtfCache,
    locale,
    locale,
    (tag) => new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }),
  );
}

export function listFormat(locale: string, type: Intl.ListFormatType): Intl.ListFormat {
  return cached(lfCache, locale + type, locale, (tag) => new Intl.ListFormat(tag, { type }));
}

export function displayNames(locale: string): Intl.DisplayNames {
  return cached(dnCache, locale, locale, (tag) => new Intl.DisplayNames(tag, { type: 'language' }));
}
