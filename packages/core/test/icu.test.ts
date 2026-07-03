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
});
