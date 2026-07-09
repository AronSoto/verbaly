import { describe, expect, it } from 'vitest';
import { createVerbaly } from '../src/index';

const t = (msg: string) => createVerbaly({ locale: 'en', messages: { en: { m: msg } } }).t;

describe('ICU escape-hatch', () => {
  it('plural with #', () => {
    const f = t('{count, plural, one {# item} other {# items}}');
    expect(f('m', { count: 1 })).toBe('1 item');
    expect(f('m', { count: 5 })).toBe('5 items');
  });

  it('plural =N exact match', () => {
    const f = t('{count, plural, =0 {none} one {# item} other {# items}}');
    expect(f('m', { count: 0 })).toBe('none');
    expect(f('m', { count: 1 })).toBe('1 item');
  });

  it('select', () => {
    const f = t('{g, select, male {he} female {she} other {they}}');
    expect(f('m', { g: 'female' })).toBe('she');
    expect(f('m', { g: 'nb' })).toBe('they');
  });

  it('selectordinal uses ordinal rules', () => {
    const f = t('{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}');
    expect(f('m', { n: 1 })).toBe('1st');
    expect(f('m', { n: 2 })).toBe('2nd');
    expect(f('m', { n: 3 })).toBe('3rd');
    expect(f('m', { n: 4 })).toBe('4th');
    expect(f('m', { n: 11 })).toBe('11th');
  });

  it('number style', () => {
    expect(t('{p, number, percent}')('m', { p: 0.5 })).toBe('50%');
  });

  it('surrounding text + simple arg', () => {
    const f = t('Hi {name}, {count, plural, one {# msg} other {# msgs}}');
    expect(f('m', { name: 'Ana', count: 2 })).toBe('Hi Ana, 2 msgs');
  });

  it('ICU apostrophe quoting', () => {
    expect(t("{n, plural, other {'#' literal}}")('m', { n: 5 })).toBe('# literal');
  });

  it('does not hijack the native format', () => {
    const f = t('{count | one: # item | other: # items}');
    expect(f('m', { count: 1 })).toBe('1 item');
    expect(f('m', { count: 3 })).toBe('3 items');
  });

  it('parses (but does not apply) plural offset', () => {
    const f = t('{n, plural, offset:1 one {# left} other {# left}}');
    expect(f('m', { n: 5 })).toBe('5 left');
  });

  it('unknown argument type degrades to a simple param', () => {
    const f = t('{a, number} {n, spellout, x {y}}');
    expect(f('m', { a: 1, n: 7 })).toBe('1 7');
  });

  it('date and time styles map to native formats', () => {
    const f = t('{d, date, long} {d, time, short}');
    const out = f('m', { d: new Date(2026, 0, 15, 14, 30) });
    expect(out).toContain('January');
    expect(out).toContain('2:30');
  });

  it('number without style and integer style', () => {
    expect(t('{n, number}')('m', { n: 1234.5 })).toBe('1,234.5');
    expect(t('{a, number} {n, number, integer}')('m', { a: 0, n: 3.7 })).toBe('0 4');
  });

  it('simple {name} args inside an ICU message', () => {
    const f = t('{name} has {n, plural, one {# item} other {# items}}');
    expect(f('m', { name: 'Ana', n: 2 })).toBe('Ana has 2 items');
  });

  it('doubled and lone apostrophes', () => {
    expect(t("{n, plural, other {it''s #}}")('m', { n: 5 })).toBe("it's 5");
    expect(t("l'app: {n, number}")('m', { n: 1 })).toBe("l'app: 1");
  });

  it('unterminated quote keeps the rest as literal', () => {
    expect(t("{n, plural, other {'# forever}}")('m', { n: 5 })).toBe('# forever}}');
  });

  it('malformed variant without braces renders empty', () => {
    expect(t('{n, plural, one}')('m', { n: 1 })).toBe('');
  });
});
