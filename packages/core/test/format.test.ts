import { describe, expect, it, vi } from 'vitest';
import { createVerbaly } from '../src/instance';
import { numberFormat } from '../src/intl';

const v = createVerbaly({
  locale: 'es',
  messages: {
    es: {
      greeting: 'Hola {name}',
      inbox: '{count | =0: sin mensajes | one: un mensaje | other: # mensajes}',
      pronoun: '{gender | male: él | female: ella | other: elle}',
      braces: 'Usa {{clave}} literal',
      pipes: '{state | on: activo || encendido | other: apagado}',
      nested: '{count | one: {name} tiene un punto | other: {name} tiene # puntos}',
      price: 'Total: {amount:currency/EUR}',
    },
    en: {
      greeting: 'Hello {name}',
      inbox: '{count | =0: no messages | one: one message | other: # messages}',
      num: '{n:number}',
      int: '{n:integer}',
      pct: '{n:percent}',
      when: '{d:date/long}',
      loud: '{word:upper}',
      ago: '{d:relative}',
      agoDays: '{n:relative/day}',
      items: '{xs:list}',
      itemsOr: '{xs:list/or}',
      dist: '{n:unit/kilometer}',
      badUnit: '{n:unit/blorp}',
      weird: '{n:frobnicate}',
      noOther: '{n | one: uno}',
      curNoArg: '{amount:currency}',
      unitNoArg: '{n:unit}',
      clock: '{d:time}',
      clockMed: '{d:time/medium}',
      datePlain: '{d:date}',
      agoBad: '{d:relative/century}',
      agoDays2: '{d:relative/day}',
      maybe: '{x}',
    },
    pt: {
      inbox: '{count | one: uma mensagem | other: # mensagens}',
    },
  },
  formatters: {
    upper: (value) => String(value).toUpperCase(),
  },
});

describe('interpolation', () => {
  it('replaces params', () => {
    expect(v.t('greeting', { name: 'Aron' })).toBe('Hola Aron');
  });

  it('keeps placeholder when param missing', () => {
    // @ts-expect-error params required
    expect(v.t('greeting')).toBe('Hola {name}');
  });

  it('escapes double braces', () => {
    expect(v.t('braces')).toBe('Usa {clave} literal');
  });
});

describe('plurals', () => {
  it('selects exact match first', () => {
    expect(v.t('inbox', { count: 0 })).toBe('sin mensajes');
  });

  it('selects one in es', () => {
    expect(v.t('inbox', { count: 1 })).toBe('un mensaje');
  });

  it('selects other with # in es', () => {
    expect(v.t('inbox', { count: 3 })).toBe('3 mensajes');
  });

  it('works in pt', () => {
    v.setLocale('pt');
    expect(v.t('inbox', { count: 1 })).toBe('uma mensagem');
    expect(v.t('inbox', { count: 5 })).toBe('5 mensagens');
    v.setLocale('es');
  });

  it('nests placeholders inside variants', () => {
    expect(v.t('nested', { count: 2, name: 'Ana' })).toBe('Ana tiene 2 puntos');
  });
});

describe('select', () => {
  it('matches string values', () => {
    expect(v.t('pronoun', { gender: 'female' })).toBe('ella');
  });

  it('falls back to other', () => {
    expect(v.t('pronoun', { gender: 'x' })).toBe('elle');
  });

  it('escapes double pipes', () => {
    expect(v.t('pipes', { state: 'on' })).toBe('activo | encendido');
  });
});

describe('formatters', () => {
  it('formats currency', () => {
    expect(v.t('price', { amount: 5 })).toContain('€');
  });

  it('formats numbers per locale', () => {
    v.setLocale('en');
    expect(v.t('num', { n: 1234.56 })).toBe('1,234.56');
    expect(v.t('int', { n: 3.7 })).toBe('4');
    expect(v.t('pct', { n: 0.5 })).toBe('50%');
    v.setLocale('es');
  });

  it('formats dates', () => {
    v.setLocale('en');
    const result = v.t('when', { d: new Date(2026, 0, 15) });
    expect(result).toContain('January');
    expect(result).toContain('2026');
    v.setLocale('es');
  });

  it('applies custom formatters', () => {
    v.setLocale('en');
    expect(v.t('loud', { word: 'hola' })).toBe('HOLA');
    v.setLocale('es');
  });
});

describe('relative time', () => {
  it('formats number + unit', () => {
    v.setLocale('en');
    expect(v.t('agoDays', { n: 3 })).toBe('in 3 days');
    expect(v.t('agoDays', { n: -1 })).toBe('yesterday'); // numeric: auto
    v.setLocale('es');
  });

  it('auto-picks the unit from a Date', () => {
    v.setLocale('en');
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    expect(v.t('ago', { d: twoHoursAgo })).toBe('2 hours ago');
    const inTenMin = new Date(Date.now() + 10 * 60 * 1000 + 500);
    expect(v.t('ago', { d: inTenMin })).toBe('in 10 minutes');
    v.setLocale('es');
  });

  it('number without unit falls back to String', () => {
    v.setLocale('en');
    expect(v.t('ago', { d: 5 })).toBe('5');
    v.setLocale('es');
  });
});

describe('lists', () => {
  it('formats conjunction and disjunction', () => {
    v.setLocale('en');
    expect(v.t('items', { xs: ['a', 'b', 'c'] })).toBe('a, b, and c');
    expect(v.t('itemsOr', { xs: ['a', 'b'] })).toBe('a or b');
    v.setLocale('es');
    v.addMessages('es', { items: '{xs:list}' });
    expect(v.t('items', { xs: ['a', 'b', 'c'] })).toBe('a, b y c');
  });

  it('auto-formats each item per locale', () => {
    v.setLocale('en');
    expect(v.t('items', { xs: [1000, 2000] })).toBe('1,000 and 2,000');
    v.setLocale('es');
  });

  it('non-array falls back to String', () => {
    v.setLocale('en');
    expect(v.t('items', { xs: 'solo' })).toBe('solo');
    v.setLocale('es');
  });
});

describe('units', () => {
  it('formats with Intl unit style', () => {
    v.setLocale('en');
    expect(v.t('dist', { n: 3 })).toBe('3 km');
    v.setLocale('es');
  });

  it('invalid unit warns once and falls back', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    v.setLocale('en');
    expect(v.t('badUnit', { n: 3 })).toBe('3');
    expect(v.t('badUnit', { n: 3 })).toBe('3');
    expect(spy).toHaveBeenCalledTimes(1);
    v.setLocale('es');
    spy.mockRestore();
  });

  it('invalid currency code warns and falls back: never throws', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = createVerbaly({ locale: 'en', messages: { en: { p: '{amount:currency/US}' } } });
    expect(bad.t('p', { amount: 5 })).toBe('5');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('invalid date/time style warns and falls back: never throws', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = createVerbaly({
      locale: 'en',
      messages: { en: { d: '{d:date/bogus}', t: '{d:time/bogus}' } },
    });
    const date = new Date('2026-01-01T00:00:00Z');
    expect(bad.t('d', { d: date })).toBe(String(date));
    expect(bad.t('t', { d: date })).toBe(String(date));
    spy.mockRestore();
  });

  it('invalid date value degrades instead of crashing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = createVerbaly({ locale: 'en', messages: { en: { d: '{d:date/short}' } } });
    expect(() => bad.t('d', { d: 'garbage' })).not.toThrow();
    spy.mockRestore();
  });

  it('invalid Date object warns and falls back in auto, hash and list: never throws', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = createVerbaly({
      locale: 'en',
      messages: { en: { auto: '{d}', hash: '{d | other: seen #}', list: '{d:list}' } },
    });
    const invalid = new Date(NaN);
    expect(bad.t('auto', { d: invalid })).toBe(String(invalid));
    expect(bad.t('hash', { d: invalid })).toBe(`seen ${String(invalid)}`);
    expect(bad.t('list', { d: [invalid] })).toBe(String(invalid));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('unknown format', () => {
  it('warns once and falls back to String', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    v.setLocale('en');
    expect(v.t('weird', { n: 7 })).toBe('7');
    expect(v.t('weird', { n: 8 })).toBe('8');
    expect(spy).toHaveBeenCalledTimes(1);
    v.setLocale('es');
    spy.mockRestore();
  });
});

describe('format fallbacks', () => {
  it('renders nothing when no variant matches and other is absent', () => {
    v.setLocale('en');
    expect(v.t('noOther', { n: 5 })).toBe('');
    v.setLocale('es');
  });

  it('currency and unit without an argument fall back to String', () => {
    v.setLocale('en');
    expect(v.t('curNoArg', { amount: 5 })).toBe('5');
    expect(v.t('unitNoArg', { n: 5 })).toBe('5');
    v.setLocale('es');
  });

  it('formats time with default and explicit styles', () => {
    v.setLocale('en');
    const d = new Date(2026, 0, 15, 14, 30, 45);
    expect(v.t('clock', { d })).toContain('2:30');
    expect(v.t('clockMed', { d })).toContain('45');
    v.setLocale('es');
  });

  it('formats a date without a style argument', () => {
    v.setLocale('en');
    expect(v.t('datePlain', { d: new Date(2026, 0, 15) })).toContain('2026');
    v.setLocale('es');
  });

  it('null params render as empty string', () => {
    v.setLocale('en');
    expect(v.t('maybe', { x: null })).toBe('');
    v.setLocale('es');
  });
});

describe('relative time with explicit unit', () => {
  it('rounds a Date into the requested unit', () => {
    v.setLocale('en');
    const inThreeDays = new Date(Date.now() + 3 * 86400 * 1000 + 1000);
    expect(v.t('agoDays2', { d: inThreeDays })).toBe('in 3 days');
    v.setLocale('es');
  });

  it('invalid unit on a Date warns and falls back to String', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    v.setLocale('en');
    const d = new Date();
    expect(v.t('agoBad', { d })).toBe(String(d));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('invalid relative unit'));
    v.setLocale('es');
    spy.mockRestore();
  });
});

describe('more format paths', () => {
  const w = createVerbaly({
    locale: 'en',
    messages: { en: { listUnit: '{xs:list/unit}', auto: '{d}' } },
  });

  it('list/unit uses the unit list type', () => {
    expect(w.t('listUnit', { xs: ['5m', '30s'] })).toContain('5m');
  });

  it('auto-formats a Date value with no explicit format', () => {
    const d = new Date('2020-06-15T12:00:00Z');
    expect(w.t('auto', { d })).toBe(new Intl.DateTimeFormat('en').format(d));
  });

  it('relative Date under a second falls back to the seconds unit', () => {
    const rel = createVerbaly({ locale: 'en', messages: { en: { now: '{d:relative}' } } });
    // a Date essentially at "now": no unit threshold matched, seconds fallback
    expect(rel.t('now', { d: new Date() })).toMatch(/second|now/);
  });
});

describe('intl cache cap', () => {
  it('reuses cached formatters', () => {
    expect(numberFormat('en')).toBe(numberFormat('en'));
  });

  it('evicts oldest entries past the cap', () => {
    const first = numberFormat('en-x-cap');
    for (let i = 0; i < 200; i++) numberFormat(`en-x-f${i}`);
    expect(numberFormat('en-x-cap')).not.toBe(first);
  });
});
