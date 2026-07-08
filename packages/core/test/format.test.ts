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
