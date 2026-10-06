import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalogs } from '../src/catalog';
import { resolveConfig } from '../src/config';
import { stableKey } from '../src/key';
import {
  acceptOutdated,
  loadState,
  outdatedTranslations,
  refreshFingerprints,
  saveState,
  STATE_FILE,
  updateState,
} from '../src/state';

function cfg() {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-state-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  return resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
}

const LEGACY = '.verbaly-drafts.json';

describe('the state sidecar', () => {
  it('reads the drafts file 0.66.0 wrote, and the first save leaves only the new file', () => {
    const c = cfg();
    writeFileSync(join(c.dir, LEGACY), JSON.stringify({ es: ['a'] }));
    const state = loadState(c);
    expect(state).toEqual({ drafts: { es: ['a'] }, fingerprints: {} });
    saveState(c, state);
    expect(existsSync(join(c.dir, LEGACY))).toBe(false);
    expect(JSON.parse(readFileSync(join(c.dir, STATE_FILE), 'utf8'))).toEqual({
      drafts: { es: ['a'] },
    });
  });

  it('prefers the new file when both exist', () => {
    const c = cfg();
    writeFileSync(join(c.dir, LEGACY), JSON.stringify({ es: ['old'] }));
    writeFileSync(join(c.dir, STATE_FILE), JSON.stringify({ drafts: { es: ['new'] } }));
    expect(loadState(c).drafts).toEqual({ es: ['new'] });
  });

  it('is gone when there is nothing left to remember', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['a'] }, fingerprints: {} });
    expect(existsSync(join(c.dir, STATE_FILE))).toBe(true);
    saveState(c, { drafts: {}, fingerprints: { es: {} } });
    expect(existsSync(join(c.dir, STATE_FILE))).toBe(false);
  });

  it('throws on a file it cannot read, so a save never erases what it held', () => {
    const c = cfg();
    writeFileSync(join(c.dir, STATE_FILE), '{not json');
    expect(() => loadState(c)).toThrow(/not valid JSON, fix or delete the file/);
    writeFileSync(join(c.dir, STATE_FILE), '["a"]');
    expect(() => loadState(c)).toThrow(/not valid JSON/);
  });

  it('skips entries of the wrong shape instead of reading them as data', () => {
    const c = cfg();
    writeFileSync(
      join(c.dir, STATE_FILE),
      JSON.stringify({ drafts: { es: ['a', 3] }, fingerprints: { es: { k: 'nodot', j: 'S.T' } } }),
    );
    const state = loadState(c);
    expect(state.drafts).toEqual({ es: ['a'] });
    expect({ ...state.fingerprints.es }).toEqual({ j: 'S.T' });
  });
});

describe('outdated translations', () => {
  const c = cfg();
  const at = (en: string, es: string): Catalogs => ({ en: { bio: en }, es: { bio: es } });

  it('stamps a translated readable key, and never a hash key or an untranslated one', () => {
    const hash = stableKey('Hello');
    const catalogs: Catalogs = {
      en: { bio: 'I write code', [hash]: 'Hello', empty: 'Nothing yet' },
      es: { bio: 'Escribo código', [hash]: 'Hola', empty: '' },
    };
    const stamped = refreshFingerprints(c, catalogs, {});
    expect(Object.keys(stamped.es ?? {})).toEqual(['bio']);
  });

  it('marks a translation outdated when only its source moved', () => {
    const before = refreshFingerprints(c, at('I write code', 'Escribo código'), {});
    const moved = at('I write software', 'Escribo código');
    expect(outdatedTranslations(c, moved, before)).toEqual([{ locale: 'es', key: 'bio' }]);
    // refreshing keeps the old stamp, so the signal survives the next extract
    expect(outdatedTranslations(c, moved, refreshFingerprints(c, moved, before))).toHaveLength(1);
  });

  it('clears it once the translation is edited, without anyone approving it', () => {
    const before = refreshFingerprints(c, at('I write code', 'Escribo código'), {});
    const updated = at('I write software', 'Escribo software');
    expect(outdatedTranslations(c, updated, before)).toEqual([]);
    expect(outdatedTranslations(c, updated, refreshFingerprints(c, updated, before))).toEqual([]);
  });

  it('clears it when the source goes back to the text it was translated from', () => {
    const before = refreshFingerprints(c, at('I write code', 'Escribo código'), {});
    expect(outdatedTranslations(c, at('I write code', 'Escribo código'), before)).toEqual([]);
  });

  it('knows nothing about a translation it never stamped', () => {
    expect(outdatedTranslations(c, at('I write software', 'Escribo código'), {})).toEqual([]);
  });

  it('acceptOutdated stamps it for the new source, which is what a person approving means', () => {
    const fingerprints = refreshFingerprints(c, at('I write code', 'Escribo código'), {});
    const moved = at('I write software', 'Escribo código');
    const entries = outdatedTranslations(c, moved, fingerprints);
    acceptOutdated(c, moved, fingerprints, entries);
    expect(outdatedTranslations(c, moved, fingerprints)).toEqual([]);
  });

  it('treats a key named like an Object member as data', () => {
    const catalogs: Catalogs = { en: { toString: 'Text' }, es: { toString: 'Texto' } };
    const stamped = refreshFingerprints(c, catalogs, {});
    const moved: Catalogs = { en: { toString: 'Other' }, es: { toString: 'Texto' } };
    expect(outdatedTranslations(c, moved, stamped)).toEqual([{ locale: 'es', key: 'toString' }]);
  });
});

describe('updateState', () => {
  it('drops the draft of a key whose translation is gone, so it cannot come back as a draft', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['nav.home', 'nav.docs'] }, fingerprints: {} });
    // nav.home was pruned: no source, no translation
    const catalogs: Catalogs = { en: { 'nav.docs': 'Docs' }, es: { 'nav.docs': 'Documentos' } };
    updateState(c, catalogs);
    expect(loadState(c).drafts).toEqual({ es: ['nav.docs'] });

    // the key returns and a person translates it: that translation is theirs, not a draft
    const back: Catalogs = {
      en: { 'nav.docs': 'Docs', 'nav.home': 'Home' },
      es: { 'nav.docs': 'Documentos', 'nav.home': 'Inicio' },
    };
    updateState(c, back);
    expect(loadState(c).drafts).toEqual({ es: ['nav.docs'] });
  });

  it('writes the fingerprints the next run compares against', () => {
    const c = cfg();
    updateState(c, { en: { bio: 'I write code' }, es: { bio: 'Escribo código' } });
    const moved: Catalogs = { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } };
    const state = updateState(c, moved);
    expect(outdatedTranslations(c, moved, state.fingerprints)).toEqual([
      { locale: 'es', key: 'bio' },
    ]);
  });
});

describe('saving drafts', () => {
  it('keeps the fingerprints, so approving a draft never erases what outdated compares against', async () => {
    const { loadDrafts, saveDrafts } = await import('../src/drafts');
    const c = cfg();
    updateState(c, { en: { bio: 'I write code' }, es: { bio: 'Escribo código' } });
    const stamped = loadState(c).fingerprints;
    saveDrafts(c, { es: ['bio'] });
    saveDrafts(c, {});
    expect(loadDrafts(c)).toEqual({});
    expect(loadState(c).fingerprints).toEqual(stamped);
  });
});
