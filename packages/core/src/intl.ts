const nfCache = new Map<string, Intl.NumberFormat>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const prCache = new Map<string, Intl.PluralRules>();

export function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = locale + (options ? JSON.stringify(options) : '');
  let fmt = nfCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, options);
    nfCache.set(key, fmt);
  }
  return fmt;
}

export function dateTimeFormat(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = locale + (options ? JSON.stringify(options) : '');
  let fmt = dtfCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    dtfCache.set(key, fmt);
  }
  return fmt;
}

export function pluralRules(locale: string): Intl.PluralRules {
  let rules = prCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    prCache.set(locale, rules);
  }
  return rules;
}
