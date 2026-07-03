const nfCache = new Map<string, Intl.NumberFormat>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();
const prCache = new Map<string, Intl.PluralRules>();

export function numberFormat(
  locale: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
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

export function pluralRules(
  locale: string,
  type: Intl.PluralRuleType = 'cardinal',
): Intl.PluralRules {
  const key = locale + type;
  let rules = prCache.get(key);
  if (!rules) {
    rules = new Intl.PluralRules(locale, { type });
    prCache.set(key, rules);
  }
  return rules;
}
