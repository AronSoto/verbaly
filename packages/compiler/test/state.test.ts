import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalogs, type Catalogs } from '../src/catalog';
import { resolveConfig } from '../src/config';
import { formatFinding } from '../src/findings';
import { stableKey } from '../src/key';
import {
  acceptOutdated,
  loadState,
  lockNews,
  outdatedTranslations,
  readState,
  recordTranslations,
  saveState,
  STATE_FILE,
  stateFile,
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
// ten git processes: a second on their own, near a minute on Windows under the full parallel suite
const GIT_TIMEOUT = 120_000;
const OLD_STATE = '.verbaly-state.json';
const OLD_DRAFTS = '.verbaly-drafts.json';
const lockPath = (c: Config) => join(c.root, STATE_FILE);
const lockOf = (c: Config) =>
  JSON.parse(readFileSync(lockPath(c), 'utf8')) as Record<string, unknown>;

describe('verbaly.lock', () => {
  it('lives at the project root and opens by saying what it is and which format it is', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['a'] }, fingerprints: {} });
    expect(existsSync(join(c.dir, OLD_STATE))).toBe(false);
    const lock = lockOf(c);
    expect(Object.keys(lock)).toEqual(['_readme', 'version', 'drafts']);
    expect(lock._readme).toMatch(/Commit it with your catalogs and never edit it/);
    expect(lock.version).toBe(1);
  });

  // Proved able to fail by reading the lock alone: the drafts and stamps 0.70.0 kept were lost.
  it('moves the state 0.70.0 kept next to the catalogs into the lock, and that file goes', () => {
    const c = cfg();
    const old = { drafts: { es: ['a'] }, fingerprints: { es: { bio: 'S.T' } }, migrated: ['es'] };
    writeFileSync(join(c.dir, OLD_STATE), JSON.stringify(old));
    const state = loadState(c);
    expect(state.drafts).toEqual({ es: ['a'] });
    expect({ ...state.fingerprints.es }).toEqual({ bio: 'S.T' });
    expect(state.migrated).toEqual(['es']);
    saveState(c, state);
    expect(existsSync(join(c.dir, OLD_STATE))).toBe(false);
    expect(lockOf(c)).toMatchObject(old);
  });

  // Proved able to fail by letting the older file win: the lock's stamp of bio was replaced.
  it('keeps the lock where both files know a translation, and takes the rest from the older one', () => {
    const c = cfg();
    writeFileSync(
      lockPath(c),
      JSON.stringify({
        drafts: { es: ['a'] },
        fingerprints: { es: { bio: 'L.L' } },
        migrated: ['es'],
      }),
    );
    writeFileSync(
      join(c.dir, OLD_STATE),
      JSON.stringify({
        drafts: { es: ['b'] },
        fingerprints: { es: { bio: 'O.O', title: 'O.T' } },
        migrated: ['pt'],
      }),
    );
    const state = loadState(c);
    expect(state.drafts).toEqual({ es: ['a', 'b'] });
    expect({ ...state.fingerprints.es }).toEqual({ bio: 'L.L', title: 'O.T' });
    expect(state.migrated).toEqual(['es', 'pt']);
  });

  // Proved able to fail by reading the old drafts file only when nothing else exists: b was lost.
  it('reads the drafts file 0.66.0 wrote as well, and the first save leaves only the lock', () => {
    const c = cfg();
    writeFileSync(join(c.dir, OLD_DRAFTS), JSON.stringify({ es: ['b'] }));
    writeFileSync(join(c.dir, OLD_STATE), JSON.stringify({ drafts: { es: ['a'] } }));
    const state = loadState(c);
    expect(state).toEqual({ drafts: { es: ['a', 'b'] }, fingerprints: {} });
    saveState(c, state);
    expect(existsSync(join(c.dir, OLD_DRAFTS))).toBe(false);
    expect(existsSync(join(c.dir, OLD_STATE))).toBe(false);
    expect(loadState(c).drafts).toEqual({ es: ['a', 'b'] });
  });

  it('is gone when there is nothing left to remember, and so are the older files', () => {
    const c = cfg();
    saveState(c, { drafts: { es: ['a'] }, fingerprints: {} });
    expect(existsSync(lockPath(c))).toBe(true);
    writeFileSync(join(c.dir, OLD_STATE), JSON.stringify({ drafts: {} }));
    saveState(c, { drafts: {}, fingerprints: { es: {} } });
    expect(existsSync(lockPath(c))).toBe(false);
    expect(existsSync(join(c.dir, OLD_STATE))).toBe(false);
  });

  it('throws on a file it cannot read, either one, and never advises deleting it', () => {
    const c = cfg();
    writeFileSync(lockPath(c), '{not json');
    expect(() => loadState(c)).toThrow(
      /verbaly\.lock is not valid JSON: restore it from git or fix it/,
    );
    expect(() => loadState(c)).toThrow(/deleting it approves every draft/);
    writeFileSync(lockPath(c), '["a"]');
    expect(() => loadState(c)).toThrow(/not valid JSON/);
    rmSync(lockPath(c));
    writeFileSync(join(c.dir, OLD_STATE), '<<<<<<< HEAD');
    expect(() => loadState(c)).toThrow(/\.verbaly-state\.json is not valid JSON/);
  });

  // Proved able to fail by reading any version: a newer file was read as this format.
  it('refuses a format newer than it reads, so it never writes one back wrong', () => {
    const c = cfg();
    writeFileSync(lockPath(c), JSON.stringify({ version: 2, drafts: { es: ['a'] } }));
    expect(() => loadState(c)).toThrow(
      /written by a newer Verbaly \(format 2\): update @verbaly\/compiler to read it/,
    );
    expect(readState(c).problem).toMatch(/newer Verbaly/);
  });

  it('reads tolerantly where it only feeds a warning, naming the problem', () => {
    const c = cfg();
    writeFileSync(lockPath(c), '{not json');
    const { state, problem } = readState(c);
    expect(state).toEqual({ drafts: {}, fingerprints: {} });
    expect(problem).toMatch(/not valid JSON/);
    expect(problem).not.toMatch(/^\[verbaly\]/);
    rmSync(lockPath(c));
    expect(readState(c).problem).toBeUndefined();
  });

  it('skips entries of the wrong shape instead of reading them as data', () => {
    const c = cfg();
    writeFileSync(
      lockPath(c),
      JSON.stringify({ drafts: { es: ['a', 3] }, fingerprints: { es: { k: 'nodot', j: 'S.T' } } }),
    );
    const state = loadState(c);
    expect(state.drafts).toEqual({ es: ['a'] });
    expect({ ...state.fingerprints.es }).toEqual({ j: 'S.T' });
  });

  // Proved able to fail by comparing paths loosely: every later save was news again.
  it('says when a save brought the lock into being, and where the state came from', () => {
    const c = cfg();
    expect(stateFile(c)).toBeUndefined();
    saveState(c, { drafts: { es: ['a'] }, fingerprints: {} });
    expect(lockNews(c, undefined)).toEqual({ file: lockPath(c) });
    expect(lockNews(c, stateFile(c))).toBeUndefined();

    const moved = cfg();
    writeFileSync(join(moved.dir, OLD_STATE), JSON.stringify({ drafts: { es: ['a'] } }));
    const before = stateFile(moved);
    saveState(moved, loadState(moved));
    expect(lockNews(moved, before)).toEqual({
      file: lockPath(moved),
      from: join(moved.dir, OLD_STATE),
    });
  });
});

describe('a merge conflict in verbaly.lock', () => {
  const BETA = stamp('beta text', 'texto beta');
  const DELTA = stamp('delta text', 'texto delta');
  // the file git leaves when two branches stamp different keys of one language
  const conflicted = (ours: string[], theirs: string[], base?: string[]) =>
    [
      '{',
      '  "_readme": "Written by Verbaly",',
      '  "version": 1,',
      '  "fingerprints": {',
      '    "es": {',
      '<<<<<<< HEAD',
      ...ours,
      ...(base ? ['||||||| base', ...base] : []),
      '=======',
      ...theirs,
      '>>>>>>> branch',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n');

  // Proved able to fail by reading the file as JSON: it was unreadable, every stamp lost.
  it('reads both sides of the stamps two branches added', () => {
    const c = cfg();
    writeFileSync(
      lockPath(c),
      conflicted([`      "a.beta": "${BETA}"`], [`      "a.delta": "${DELTA}"`]),
    );
    expect({ ...loadState(c).fingerprints.es }).toEqual({ 'a.beta': BETA, 'a.delta': DELTA });
  });

  it('reads the diff3 style, leaving out what the base had', () => {
    const c = cfg();
    const text = conflicted(
      [`      "a.beta": "${BETA}",`, '      "a.gamma": "G.G"'],
      [`      "a.beta": "${BETA}",`, `      "a.delta": "${DELTA}"`],
      [`      "a.beta": "${BETA}",`, '      "a.old": "O.O"'],
    );
    writeFileSync(lockPath(c), text.replaceAll('\n', '\r\n'));
    expect({ ...loadState(c).fingerprints.es }).toEqual({
      'a.beta': BETA,
      'a.gamma': 'G.G',
      'a.delta': DELTA,
    });
  });

  // Proved able to fail by keeping one side's drafts: the other side's draft read as reviewed.
  it('keeps every draft either side lists, so a merge never approves one', () => {
    const c = cfg();
    const text = [
      '{',
      '  "version": 1,',
      '  "drafts": {',
      '    "es": [',
      '      "a",',
      '<<<<<<< HEAD',
      '      "b"',
      '=======',
      '      "c"',
      '>>>>>>> branch',
      '    ]',
      '  }',
      '}',
    ].join('\n');
    writeFileSync(lockPath(c), text);
    expect(loadState(c).drafts).toEqual({ es: ['a', 'b', 'c'] });
  });

  // Proved able to fail by letting the first side win: the stamp of the dropped text stayed.
  it('keeps the stamp of the translation the catalog holds when both sides stamped one key', () => {
    const ours = stamp('Hello', 'Hola');
    const theirs = stamp('Hello', 'Hola!');
    const lock = conflicted([`      "greeting": "${ours}"`], [`      "greeting": "${theirs}"`]);
    for (const [kept, stamped] of [
      ['Hola!', theirs],
      ['Hola', ours],
      ['Buenas', ours],
    ] as const) {
      const c = cfg();
      onDisk(c, { en: { greeting: 'Hello' }, es: { greeting: kept } });
      writeFileSync(lockPath(c), lock);
      expect(loadState(c).fingerprints.es?.greeting).toBe(stamped);
    }
  });

  // Proved able to fail by never recording the conflict: the save said nothing about it.
  it('is written whole by the next save, which says so once', () => {
    const c = cfg();
    onDisk(c, {
      en: { 'a.beta': 'beta text', 'a.delta': 'delta text' },
      es: { 'a.beta': 'texto beta', 'a.delta': 'texto delta' },
    });
    writeFileSync(
      lockPath(c),
      conflicted([`      "a.beta": "${BETA}"`], [`      "a.delta": "${DELTA}"`]),
    );
    const before = stateFile(c);
    updateState(c, loadCatalogs(c));
    const text = readFileSync(lockPath(c), 'utf8');
    expect(text).not.toMatch(/^[<=>|]{7}/m);
    expect((lockOf(c).fingerprints as Record<string, unknown>).es).toEqual({
      'a.beta': BETA,
      'a.delta': DELTA,
    });
    const news = lockNews(c, before);
    expect(news).toEqual({ file: lockPath(c), merged: true });
    expect(formatFinding({ kind: 'lock', ...news! }, c.root)).toBe(
      'verbaly.lock had a merge conflict and now holds both sides, drafts and stamps included: add it to the commit that resolves the merge',
    );
    expect(lockNews(c, stateFile(c))).toBeUndefined();
  });

  it('is read through where it only feeds a warning, and nothing is written', () => {
    const c = cfg();
    const text = conflicted([`      "a.beta": "${BETA}"`], [`      "a.delta": "${DELTA}"`]);
    writeFileSync(lockPath(c), text);
    const read = readState(c);
    expect(read.problem).toBeUndefined();
    expect(read.conflict).toBe(true);
    expect(Object.keys(read.state.fingerprints.es ?? {})).toEqual(['a.beta', 'a.delta']);
    expect(readFileSync(lockPath(c), 'utf8')).toBe(text);
    rmSync(lockPath(c));
    expect(readState(c).conflict).toBeUndefined();
  });

  it('names a conflict it cannot read without advising to take one side', () => {
    const c = cfg();
    writeFileSync(lockPath(c), conflicted(['      "a.beta": '], [`      "a.delta": "${DELTA}"`]));
    expect(() => loadState(c)).toThrow(
      /verbaly\.lock has a merge conflict Verbaly cannot read: resolve it by hand and keep the entries of both sides/,
    );
    const read = readState(c);
    expect(read.problem).toMatch(/merge conflict/);
    expect(read.conflict).toBe(true);
  });

  // Proved able to fail by reading the file as JSON, as 0.71.0 did: the merge left it unreadable.
  it(
    'merges what two real git branches stamped, after git marks the lock as a conflict',
    () => {
      const c = cfg();
      // a throwaway repository: the developer's identity, line endings and signing never reach it
      const isolated = [
        'user.email=t@t',
        'user.name=t',
        'core.autocrlf=false',
        'commit.gpgsign=false',
      ];
      const git = (...args: string[]) =>
        execFileSync('git', [...isolated.flatMap((setting) => ['-c', setting]), ...args], {
          cwd: c.root,
          stdio: 'pipe',
        });
      const keys = ['a.alpha', 'a.beta', 'a.gamma', 'a.delta', 'a.epsilon', 'a.zeta'];
      const en = Object.fromEntries(keys.map((key) => [key, `${key.slice(2)} text`]));
      const es: Record<string, string> = Object.fromEntries(keys.map((key) => [key, '']));
      const translate = (key: string, text: string) => {
        es[key] = text;
        writeFileSync(join(c.dir, 'es.json'), JSON.stringify(es, null, 2) + '\n');
        updateState(c, loadCatalogs(c));
      };
      writeFileSync(join(c.dir, 'en.json'), JSON.stringify(en, null, 2) + '\n');
      git('init', '-q', '-b', 'main');
      translate('a.alpha', 'texto alfa');
      git('add', '-A');
      git('commit', '-q', '-m', 'base');
      git('checkout', '-q', '-b', 'one');
      translate('a.gamma', 'texto gamma');
      git('commit', '-q', '-am', 'one');
      git('checkout', '-q', 'main');
      es['a.gamma'] = '';
      git('checkout', '-q', '-b', 'two');
      translate('a.zeta', 'texto zeta');
      git('commit', '-q', '-am', 'two');
      git('checkout', '-q', 'one');
      expect(() => git('merge', '-q', 'two')).toThrow();
      expect(readFileSync(lockPath(c), 'utf8')).toMatch(/^<{7} HEAD/m);
      expect(readState(c).conflict).toBe(true);
      updateState(c, loadCatalogs(c));
      expect(Object.keys(lockOf(c).fingerprints as Record<string, Record<string, string>>)).toEqual(
        ['es'],
      );
      const stamps = (lockOf(c).fingerprints as Record<string, Record<string, string>>).es!;
      expect(Object.keys(stamps).sort()).toEqual(['a.alpha', 'a.gamma', 'a.zeta']);
    },
    GIT_TIMEOUT,
  );
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

describe('the state file and its readers, on any machine', () => {
  it('keeps the line endings the file was checked out with', () => {
    const c = cfg();
    const path = lockPath(c);
    saveState(c, { drafts: { es: ['a'] }, fingerprints: {} });
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
    saveState(c, { drafts: { es: ['a', 'b'] }, fingerprints: {} });
    const written = readFileSync(path, 'utf8');
    expect(written).toContain('"b"\r\n');
    expect(written.replace(/\r\n/g, '')).not.toContain('\n');
  });

  // Proved able to fail by templating on the lock alone: the moved file came out with LF.
  it('a lock that replaces an older file keeps the line endings that file had', () => {
    const c = cfg();
    const crlf = JSON.stringify({ drafts: { es: ['a'] } }, null, 2).replace(/\n/g, '\r\n');
    writeFileSync(join(c.dir, OLD_STATE), crlf + '\r\n');
    saveState(c, loadState(c));
    const written = readFileSync(lockPath(c), 'utf8');
    expect(written).toContain('"a"\r\n');
    expect(written.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('lists outdated translations in code unit order, never the order of the machine language', () => {
    const c = cfg();
    const catalogs = { en: { B: 'One', a: 'Two' }, es: { B: 'Uno', a: 'Dos' } };
    const fingerprints = { es: { B: stamp('Old', 'Uno'), a: stamp('Old', 'Dos') } };
    // "B" before "a" by code unit; localeCompare puts "a" first
    expect(outdatedTranslations(c, catalogs, fingerprints).map((entry) => entry.key)).toEqual([
      'B',
      'a',
    ]);
  });
});
