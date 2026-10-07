import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  readState,
  recordTranslations,
  saveState,
  STATE_FILE,
  updateState,
} from '../src/state';

function cfg(locales = ['en', 'es']) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-state-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  return resolveConfig({ root, sourceLocale: 'en', locales });
}

type Config = ReturnType<typeof cfg>;

// the catalogs on disk, the way every caller of updateState has just written them
function onDisk(c: Config, catalogs: Catalogs): Catalogs {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    writeFileSync(join(c.dir, `${locale}.json`), JSON.stringify(catalog));
  }
  return catalogs;
}

const refresh = (c: Config, catalogs: Catalogs) => updateState(c, onDisk(c, catalogs)).fingerprints;
const stamp = (source: string, translated: string) =>
  `${stableKey(source)}.${stableKey(translated)}`;
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

  // Proved able to fail by reading the old file only when the new one is missing: b was dropped.
  it('keeps the drafts a teammate on 0.66.0 wrote next to the new file', () => {
    const c = cfg();
    writeFileSync(join(c.dir, LEGACY), JSON.stringify({ es: ['b'] }));
    writeFileSync(join(c.dir, STATE_FILE), JSON.stringify({ drafts: { es: ['a'] } }));
    const state = loadState(c);
    expect(state.drafts).toEqual({ es: ['a', 'b'] });
    saveState(c, state);
    expect(existsSync(join(c.dir, LEGACY))).toBe(false);
    expect(loadState(c).drafts).toEqual({ es: ['a', 'b'] });
  });

  it('is gone when there is nothing left to remember', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['a'] }, fingerprints: {} });
    expect(existsSync(join(c.dir, STATE_FILE))).toBe(true);
    saveState(c, { drafts: {}, fingerprints: { es: {} } });
    expect(existsSync(join(c.dir, STATE_FILE))).toBe(false);
  });

  it('throws on a file it cannot read, and never advises deleting it', () => {
    const c = cfg();
    writeFileSync(join(c.dir, STATE_FILE), '{not json');
    expect(() => loadState(c)).toThrow(/not valid JSON: restore it from git or fix it/);
    expect(() => loadState(c)).toThrow(/deleting it approves every draft/);
    writeFileSync(join(c.dir, STATE_FILE), '["a"]');
    expect(() => loadState(c)).toThrow(/not valid JSON/);
  });

  it('reads tolerantly where it only feeds a warning, naming the problem', () => {
    const c = cfg();
    writeFileSync(join(c.dir, STATE_FILE), '{not json');
    const { state, problem } = readState(c);
    expect(state).toEqual({ drafts: {}, fingerprints: {} });
    expect(problem).toMatch(/not valid JSON/);
    expect(problem).not.toMatch(/^\[verbaly\]/);
    rmSync(join(c.dir, STATE_FILE));
    expect(readState(c).problem).toBeUndefined();
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
  const at = (en: string, es: string): Catalogs => ({ en: { bio: en }, es: { bio: es } });

  it('stamps a translated readable key, and never a hash key or an untranslated one', () => {
    const hash = stableKey('Hello');
    const stamped = refresh(cfg(), {
      en: { bio: 'I write code', [hash]: 'Hello', empty: 'Nothing yet' },
      es: { bio: 'Escribo código', [hash]: 'Hola', empty: '' },
    });
    expect(Object.keys(stamped.es ?? {})).toEqual(['bio']);
  });

  it('marks a translation outdated when only its source moved, and keeps the mark', () => {
    const c = cfg();
    const before = refresh(c, at('I write code', 'Escribo código'));
    const moved = at('I write software', 'Escribo código');
    expect(outdatedTranslations(c, moved, before)).toEqual([{ locale: 'es', key: 'bio' }]);
    // refreshing keeps the old stamp, so the signal survives the next extract
    expect(outdatedTranslations(c, moved, refresh(c, moved))).toHaveLength(1);
  });

  it('clears it once the translation is edited, without anyone approving it', () => {
    const c = cfg();
    const before = refresh(c, at('I write code', 'Escribo código'));
    const updated = at('I write software', 'Escribo software');
    expect(outdatedTranslations(c, updated, before)).toEqual([]);
    expect(outdatedTranslations(c, updated, refresh(c, updated))).toEqual([]);
  });

  it('clears it when the source goes back to the text it was translated from', () => {
    const c = cfg();
    const before = refresh(c, at('I write code', 'Escribo código'));
    expect(outdatedTranslations(c, at('I write code', 'Escribo código'), before)).toEqual([]);
  });

  it('knows nothing about a translation it never stamped', () => {
    expect(outdatedTranslations(cfg(), at('I write software', 'Escribo código'), {})).toEqual([]);
  });

  // Proved able to fail by dropping the stamp of a key with no source: the mark never came back.
  it('keeps the stamp while the source is empty for a moment, so the mark survives a retype', () => {
    const c = cfg();
    refresh(c, at('I write code', 'Escribo código'));
    refresh(c, at('', 'Escribo código'));
    const moved = at('I write software', 'Escribo código');
    expect(outdatedTranslations(c, moved, refresh(c, moved))).toEqual([
      { locale: 'es', key: 'bio' },
    ]);
  });

  it('acceptOutdated stamps it for the new source, which is what a person approving means', () => {
    const c = cfg();
    const fingerprints = refresh(c, at('I write code', 'Escribo código'));
    const moved = at('I write software', 'Escribo código');
    const entries = outdatedTranslations(c, moved, fingerprints);
    acceptOutdated(c, moved, fingerprints, entries);
    expect(outdatedTranslations(c, moved, fingerprints)).toEqual([]);
  });

  it('treats a key named like an Object member as data', () => {
    const c = cfg();
    const stamped = refresh(c, { en: { toString: 'Text' }, es: { toString: 'Texto' } });
    const moved: Catalogs = { en: { toString: 'Other' }, es: { toString: 'Texto' } };
    expect(outdatedTranslations(c, moved, stamped)).toEqual([{ locale: 'es', key: 'toString' }]);
  });
});

describe('updateState', () => {
  it('drops the draft of a key whose translation is gone, so it cannot come back as a draft', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['nav.home', 'nav.docs'] }, fingerprints: {} });
    // nav.home was pruned: no source, no translation
    refresh(c, { en: { 'nav.docs': 'Docs' }, es: { 'nav.docs': 'Documentos' } });
    expect(loadState(c).drafts).toEqual({ es: ['nav.docs'] });

    // the key returns and a person translates it: that translation is theirs, not a draft
    refresh(c, {
      en: { 'nav.docs': 'Docs', 'nav.home': 'Home' },
      es: { 'nav.docs': 'Documentos', 'nav.home': 'Inicio' },
    });
    expect(loadState(c).drafts).toEqual({ es: ['nav.docs'] });
  });

  it('writes the fingerprints the next run compares against', () => {
    const c = cfg();
    refresh(c, { en: { bio: 'I write code' }, es: { bio: 'Escribo código' } });
    const moved: Catalogs = { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } };
    expect(outdatedTranslations(c, moved, refresh(c, moved))).toEqual([
      { locale: 'es', key: 'bio' },
    ]);
  });

  // Proved able to fail by rebuilding every locale from the run's view: pt's draft and stamp left.
  it('leaves a locale it was not shown as it was, like the rest of a narrowed --locales run', () => {
    const full = cfg(['en', 'es', 'pt']);
    saveState(full, {
      drafts: { pt: ['bio'] },
      fingerprints: { pt: { bio: stamp('I write code', 'Escrevo código') } },
    });
    const narrowed = resolveConfig({ root: full.root, sourceLocale: 'en', locales: ['en', 'es'] });
    updateState(
      narrowed,
      onDisk(narrowed, { en: { bio: 'I write code' }, es: { bio: 'Escribo' } }),
    );
    const state = loadState(full);
    expect(state.drafts).toEqual({ pt: ['bio'] });
    expect(state.fingerprints.pt?.bio).toBe(stamp('I write code', 'Escrevo código'));
    expect(Object.keys(state.fingerprints.es ?? {})).toEqual(['bio']);
  });

  // Proved able to fail by refreshing a locale whose file was missing: es lost its draft.
  it('leaves a locale whose catalog is missing for a moment, as in the middle of a checkout', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['bio'] }, fingerprints: {} });
    writeFileSync(join(c.dir, 'en.json'), JSON.stringify({ bio: 'I write code' }));
    updateState(c, { en: { bio: 'I write code' }, es: {} });
    expect(loadState(c).drafts).toEqual({ es: ['bio'] });
  });

  it('reads nested catalogs the way t() does, instead of throwing on a group', () => {
    const c = cfg();
    const nested = {
      en: { about: { bio: 'I write code' } },
      es: { about: { bio: 'Escribo código' } },
    } as unknown as Catalogs;
    const fingerprints = updateState(c, onDisk(c, nested)).fingerprints;
    expect(Object.keys(fingerprints.es ?? {})).toEqual(['about.bio']);
  });
});

describe('recordTranslations', () => {
  // Proved able to fail by leaving the stamp to the next refresh: it stamped the newer source.
  it('stamps a translation for the source it was written for, so a later change is caught', () => {
    const c = cfg();
    onDisk(c, { en: { bio: 'I write code' }, es: { bio: 'Escribo código' } });
    recordTranslations(c, { bio: 'I write code' }, [
      { locale: 'es', entries: [{ key: 'bio', text: 'Escribo código' }], draft: true },
    ]);
    // the source moves before anything refreshes the state
    const moved = refresh(c, { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } });
    const catalogs: Catalogs = { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } };
    expect(outdatedTranslations(c, catalogs, moved)).toEqual([{ locale: 'es', key: 'bio' }]);
    expect(loadState(c).drafts).toEqual({ es: ['bio'] });
  });

  it('stamps a file translated from an older text against that text, so it reads as outdated', () => {
    const c = cfg();
    const state = recordTranslations(c, { bio: 'I write software' }, [
      {
        locale: 'es',
        entries: [{ key: 'bio', text: 'Escribo código', source: 'I write code' }],
        draft: false,
      },
    ]);
    const catalogs: Catalogs = { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } };
    expect(outdatedTranslations(c, catalogs, state.fingerprints)).toEqual([
      { locale: 'es', key: 'bio' },
    ]);
  });

  it('clears the draft flag for a person, sets it for a machine, and leaves it when not told', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['a', 'b'] }, fingerprints: {} });
    const source = { a: 'A', b: 'B', c: 'C' };
    recordTranslations(c, source, [
      { locale: 'es', entries: [{ key: 'a', text: 'A!' }], draft: false },
    ]);
    recordTranslations(c, source, [
      { locale: 'es', entries: [{ key: 'c', text: 'C!' }], draft: true },
    ]);
    recordTranslations(c, source, [{ locale: 'es', entries: [{ key: 'b', text: 'B!' }] }]);
    expect(loadState(c).drafts).toEqual({ es: ['b', 'c'] });
  });
});

describe('saving drafts', () => {
  it('keeps the fingerprints, so approving a draft never erases what outdated compares against', async () => {
    const { loadDrafts, saveDrafts } = await import('../src/drafts');
    const c = cfg();
    refresh(c, { en: { bio: 'I write code' }, es: { bio: 'Escribo código' } });
    const stamped = loadState(c).fingerprints;
    saveDrafts(c, { es: ['bio'] });
    saveDrafts(c, {});
    expect(loadDrafts(c)).toEqual({});
    expect(loadState(c).fingerprints).toEqual(stamped);
  });
});
