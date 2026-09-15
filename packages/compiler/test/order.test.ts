import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogPath, readCatalog, writeCatalog } from '../src/catalog';
import { resolveConfig } from '../src/config';

// the file is written as a string so its key order is exactly what the test means
function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-order-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  for (const [locale, body] of Object.entries(files)) {
    writeFileSync(join(dir, `${locale}.json`), body);
  }
  return resolveConfig({ root, sourceLocale: 'en' });
}

function keysOf(cfg: ReturnType<typeof resolveConfig>, locale: string): string[] {
  return Object.keys(JSON.parse(readFileSync(catalogPath(cfg, locale), 'utf8')));
}

function groupKeys(cfg: ReturnType<typeof resolveConfig>, locale: string, group: string): string[] {
  const tree = JSON.parse(readFileSync(catalogPath(cfg, locale), 'utf8'));
  return Object.keys(tree[group]);
}

describe('a catalog keeps the order the file already had', () => {
  // Proved able to fail by dropping orderLike: it rewrites all four lines alphabetically.
  it('leaves a hand-ordered file alone when nothing changed', () => {
    const body = '{\n  "common": "c",\n  "a11y": "a",\n  "nav": "n",\n  "hero": "h"\n}\n';
    const cfg = project({ en: body });
    const before = readCatalog(cfg, 'en');
    writeCatalog(cfg, 'en', before);
    expect(keysOf(cfg, 'en')).toEqual(['common', 'a11y', 'nav', 'hero']);
  });

  // this is the headline case: alphabetical reads the sentence backwards
  it('keeps the pieces of a split sentence in reading order', () => {
    const body = '{\n  "claim_start": "Your catalogs,",\n  "claim_mid": "in",\n  "claim_end": "one screen"\n}\n';
    const cfg = project({ en: body });
    writeCatalog(cfg, 'en', readCatalog(cfg, 'en'));
    expect(keysOf(cfg, 'en')).toEqual(['claim_start', 'claim_mid', 'claim_end']);
  });

  // Proved able to fail by appending unconditionally: the new key lands last instead of second.
  it('keeps sorting a file that was already sorted, so a new key lands in its place', () => {
    const cfg = project({ en: '{\n  "a": "1",\n  "c": "3"\n}\n' });
    writeCatalog(cfg, 'en', { ...readCatalog(cfg, 'en'), b: '2' });
    expect(keysOf(cfg, 'en')).toEqual(['a', 'b', 'c']);
  });

  it('adds a new key at the end of an unordered level, where it reads as an addition', () => {
    const cfg = project({ en: '{\n  "zebra": "z",\n  "apple": "a"\n}\n' });
    writeCatalog(cfg, 'en', { ...readCatalog(cfg, 'en'), middle: 'm' });
    expect(keysOf(cfg, 'en')).toEqual(['zebra', 'apple', 'middle']);
  });

  // Proved able to fail by deciding once for the whole file: the group would follow the root.
  it('decides per level, so an ordered group inside an unordered file keeps sorting', () => {
    const body = '{\n  "zebra": { "a": "1", "c": "3" },\n  "apple": { "n": "n", "b": "b" }\n}\n';
    const cfg = project({ en: body });
    const catalog = { ...readCatalog(cfg, 'en'), 'zebra.b': '2', 'apple.a': 'a' };
    writeCatalog(cfg, 'en', catalog);
    expect(keysOf(cfg, 'en')).toEqual(['zebra', 'apple']);
    expect(groupKeys(cfg, 'en', 'zebra')).toEqual(['a', 'b', 'c']);
    expect(groupKeys(cfg, 'en', 'apple')).toEqual(['n', 'b', 'a']);
  });

  it('sorts a locale that has no file yet, which is every catalog verbaly writes first', () => {
    const cfg = project({ en: '{\n  "zebra": "z",\n  "apple": "a"\n}\n', es: '{}' });
    writeCatalog(cfg, 'es', { zebra: 'z', apple: 'a' });
    expect(keysOf(cfg, 'es')).toEqual(['apple', 'zebra']);
  });

  it('drops a key the catalog no longer has, wherever it sat', () => {
    const cfg = project({ en: '{\n  "zebra": "z",\n  "apple": "a",\n  "kiwi": "k"\n}\n' });
    const catalog = readCatalog(cfg, 'en');
    delete catalog.apple;
    writeCatalog(cfg, 'en', catalog);
    expect(keysOf(cfg, 'en')).toEqual(['zebra', 'kiwi']);
  });

  // a file it cannot parse is not an order to preserve, and the old shape rule still applies
  it('falls back to sorted when the previous file is not valid JSON', () => {
    const cfg = project({ en: '{ not json', es: '{}' });
    writeCatalog(cfg, 'es', { zebra: 'z', apple: 'a' });
    expect(keysOf(cfg, 'es')).toEqual(['apple', 'zebra']);
  });

  it('still skips a write whose result is identical, so nothing watching retriggers', () => {
    const body = '{\n  "zebra": "z",\n  "apple": "a"\n}\n';
    const cfg = project({ en: body });
    expect(writeCatalog(cfg, 'en', readCatalog(cfg, 'en'))).toBe(body);
    expect(readFileSync(catalogPath(cfg, 'en'), 'utf8')).toBe(body);
  });
});
