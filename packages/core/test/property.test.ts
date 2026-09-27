import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVerbaly } from '../src/instance';
import { parse } from '../src/parse';
import { parseTags, type TagNode } from '../src/tags';

// pillar 3 as a property: the generator mixes real syntax fragments, random strings miss them

const SYNTAX_SOUP = fc
  .array(
    fc.constantFrom(
      '{',
      '}',
      '{{',
      '}}',
      '|',
      '||',
      ':',
      '/',
      '#',
      '##',
      '<',
      '>',
      '</',
      '/>',
      '&',
      ';',
      ',',
      ' ',
      'name',
      'count',
      'n',
      'x',
      'em',
      'one',
      'other',
      '=0',
      'plural',
      'select',
      '{name}',
      '{count:number}',
      '{v:currency/XYZ}',
      '{d:date/bogus}',
      '{v:list}',
      '{n | one: x | other: # y}',
      '<em>',
      '</em>',
      '<br/>',
      '<a>',
      '&#123;',
      '&#x7B;',
      '&amp;',
      '&lt;',
      '&#xFFFFFFFF;',
      'constructor',
      'toString',
      '__proto__',
      '{n:constructor}',
      '{n:__proto__}',
      '<constructor>',
      '</constructor>',
    ),
    { maxLength: 24 },
  )
  .map((parts) => parts.join(''));

const MESSAGE = fc.oneof(fc.string(), fc.string({ unit: 'binary' }), SYNTAX_SOUP);

const PARAM_VALUE = fc.oneof(
  fc.string(),
  fc.double(),
  fc.integer(),
  fc.boolean(),
  fc.date(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(new Date(NaN)),
  fc.object(),
);

const PARAMS = fc.dictionary(
  fc.constantFrom('name', 'count', 'n', 'v', 'd', 'x', '_0'),
  PARAM_VALUE,
);

// a locale arrives from a url, a cookie or a config typo, so the runtime cannot trust its spelling
const LOCALE = fc.oneof(
  fc.string(),
  fc.constantFrom('pt_BR', 'EN_us', 'constructor', '__proto__', 'toString', '', 'x', 'zh-Hant-TW'),
);

// the values that throw on coercion, next to everything a param can be
const TAGGED_VALUE = fc.oneof(
  PARAM_VALUE,
  fc.constant(Object.create(null) as object),
  fc.constant(JSON.parse('{"toString":{}}') as object),
  fc.constant(Symbol('s')),
);

let warn: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warn.mockRestore());

describe('parser properties (never crash)', () => {
  it('parse accepts any string and returns nodes', () => {
    fc.assert(
      fc.property(MESSAGE, (message) => {
        const nodes = parse(message);
        expect(Array.isArray(nodes)).toBe(true);
      }),
    );
  });

  it('parseTags accepts any string and returns a tag tree', () => {
    const walk = (nodes: TagNode[]): void => {
      for (const node of nodes) {
        if (typeof node === 'string') continue;
        expect(typeof node.name).toBe('string');
        walk(node.children);
      }
    };
    fc.assert(
      fc.property(MESSAGE, (message) => {
        walk(parseTags(message));
      }),
    );
  });

  it('t returns a string for any catalog message and any params', () => {
    fc.assert(
      fc.property(MESSAGE, PARAMS, (message, params) => {
        const v = createVerbaly({ locale: 'en', messages: { en: { m: message } } });
        const out = v.t('m', params as never);
        expect(typeof out).toBe('string');
      }),
    );
  });

  // every run reaches Intl: a random message with a random param only rarely would
  it('t returns a string in any locale, a tag Intl cannot read included', () => {
    const message = '{n:number} {n | one: # a | other: # b} {d:date} {d:time} {l:list} {n}';
    fc.assert(
      fc.property(LOCALE, fc.double(), (locale, n) => {
        const v = createVerbaly({ locale, messages: { [locale]: { m: message } } });
        const out = v.t('m', { n, d: new Date(0), l: ['a', 'b'] } as never);
        expect(typeof out).toBe('string');
      }),
    );
  });

  it('the tagged template returns a string for any value', () => {
    const v = createVerbaly({ locale: 'en' });
    fc.assert(
      fc.property(TAGGED_VALUE, (value) => {
        expect(typeof v.t`a${value}b`).toBe('string');
      }),
    );
  });

  it('t is deterministic: the same message and params format twice identically', () => {
    fc.assert(
      fc.property(MESSAGE, PARAMS, (message, params) => {
        const v = createVerbaly({ locale: 'en', messages: { en: { m: message } } });
        expect(v.t('m', params as never)).toBe(v.t('m', params as never));
      }),
    );
  });
});
