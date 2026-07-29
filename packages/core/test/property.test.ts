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

  it('t is deterministic: the same message and params format twice identically', () => {
    fc.assert(
      fc.property(MESSAGE, PARAMS, (message, params) => {
        const v = createVerbaly({ locale: 'en', messages: { en: { m: message } } });
        expect(v.t('m', params as never)).toBe(v.t('m', params as never));
      }),
    );
  });
});
