import { describe, expect, it } from 'vitest';
import * as verbaly from '../src/index';
import { bindDom, createVerbaly, flatten, parse } from '../src/index';

// Pinned like the compiler's, without reading source: core carries no node types on purpose.
const VALUES = [
  'LOCALE_STORAGE_KEY',
  'RICH_TAGS',
  'bindDom',
  'createVerbaly',
  'flatten',
  'localeDirection',
  'localeName',
  'negotiateLocale',
  'normalizeLink',
  'parse',
  'parseTags',
  'persistLocale',
  'resolveLocale',
  'resolveRequestLocale',
  'safeAttribute',
  'safeHref',
  'switchLocale',
];

describe('public API', () => {
  it('exports the runtime surface', () => {
    expect(createVerbaly).toBeTypeOf('function');
    expect(bindDom).toBeTypeOf('function');
    expect(parse).toBeTypeOf('function');
    expect(flatten).toBeTypeOf('function');
  });

  it('exports exactly the reviewed value list', () => {
    expect(Object.keys(verbaly).sort()).toEqual(VALUES);
  });

  it('never exports t: it comes from an instance, and doctor errors when a project imports it', () => {
    expect(verbaly).not.toHaveProperty('t');
  });
});
