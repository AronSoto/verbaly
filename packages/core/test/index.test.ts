import { describe, expect, it } from 'vitest';
import * as verbaly from '../src/index';
import { bindDom, createVerbaly, flatten, parse } from '../src/index';

// Pinned like the compiler's, without reading source: core carries no node types on purpose.
const VALUES = [
  'LOCALE_STORAGE_KEY',
  'RICH_TAGS',
  'VOID_TAGS',
  'alternateLinks',
  'bindDom',
  'createVerbaly',
  'flatten',
  'localeDirection',
  'localeFromPath',
  'localeName',
  'localePath',
  'negotiateLocale',
  'normalizeLink',
  'parse',
  'parseIcu',
  'parseTags',
  'persistLocale',
  'relativeFormatter',
  'resolveLocale',
  'resolveRequestLocale',
  'safeAttribute',
  'safeHref',
  'stripLocalePath',
  'switchLocale',
  'warnOnce',
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
