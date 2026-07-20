import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import {
  clearDrafts,
  DRAFTS_FILE,
  effectiveDrafts,
  loadDrafts,
  markDrafts,
  saveDrafts,
  type Drafts,
} from '../src/drafts';

function cfg() {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-drafts-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  return resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
}

describe('drafts sidecar', () => {
  it('round-trips through disk, sorted and deduped', () => {
    const c = cfg();
    const drafts: Drafts = { es: ['b', 'a', 'a'] };
    saveDrafts(c, drafts);
    const raw = readFileSync(join(c.dir, DRAFTS_FILE), 'utf8');
    expect(raw).toBe('{\n  "es": [\n    "a",\n    "b"\n  ]\n}\n');
    expect(loadDrafts(c)).toEqual({ es: ['a', 'b'] });
  });

  it('missing file loads as no drafts; a corrupt file throws', () => {
    const c = cfg();
    expect(loadDrafts(c)).toEqual({});
    writeFileSync(join(c.dir, DRAFTS_FILE), '{not json');
    expect(() => loadDrafts(c)).toThrow(/not valid JSON/);
  });

  it('mark adds keys and dedupes; empty writes drop the locale', () => {
    const drafts: Drafts = {};
    markDrafts(drafts, 'es', ['a', 'b']);
    markDrafts(drafts, 'es', ['b', 'c']);
    markDrafts(drafts, 'es', []); // no-op
    expect(drafts.es!.sort()).toEqual(['a', 'b', 'c']);
  });

  it('clear removes specific keys or the whole locale', () => {
    const drafts: Drafts = { es: ['a', 'b', 'c'], pt: ['x'] };
    clearDrafts(drafts, 'es', ['a']);
    expect(drafts.es).toEqual(['b', 'c']);
    clearDrafts(drafts, 'es'); // no keys → drop the locale
    expect(drafts.es).toBeUndefined();
    clearDrafts(drafts, 'nope', ['x']); // unknown locale is a no-op
    clearDrafts(drafts, 'pt', ['x']); // emptying drops the locale
    expect(drafts.pt).toBeUndefined();
  });

  it('effectiveDrafts keeps only keys whose translation is still present', () => {
    const drafts: Drafts = { es: ['a', 'b'], pt: ['a'] };
    const catalogs = { es: { a: 'La A', b: '' }, pt: {} };
    expect(effectiveDrafts(drafts, catalogs)).toEqual({ es: ['a'] });
  });

  it('save is content-compared: an identical write is a no-op', () => {
    const c = cfg();
    saveDrafts(c, { es: ['a'] });
    const path = join(c.dir, DRAFTS_FILE);
    const before = readFileSync(path, 'utf8');
    saveDrafts(c, { es: ['a'] });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
