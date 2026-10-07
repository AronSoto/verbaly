import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDrafts, resolveConfig, saveDrafts } from '@verbaly/compiler';
import type { ResolvedConfig } from '@verbaly/compiler';
import { approve, buildState, unapprove, writeMessage } from '../src/api';

const made: string[] = [];

function project(drafts: Record<string, string[]> = {}): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-studio-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'en.json'), JSON.stringify({ hello: 'Hello', bye: 'Bye' }, null, 2));
  writeFileSync(join(dir, 'es.json'), JSON.stringify({ hello: 'Hola', bye: 'Adios' }, null, 2));
  writeFileSync(join(dir, 'de.json'), JSON.stringify({ hello: 'Hallo', bye: 'Tschuss' }, null, 2));
  writeFileSync(join(dir, '.verbaly-drafts.json'), JSON.stringify(drafts, null, 2) + '\n');
  return resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es', 'de'] });
}

function nested(): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-studio-nested-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  const tree = (home: string, docs: string) => JSON.stringify({ nav: { home, docs } }, null, 2);
  writeFileSync(join(dir, 'en.json'), tree('Home', 'Docs'));
  writeFileSync(join(dir, 'es.json'), tree('Inicio', 'Docs'));
  return resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });
}

function params(): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-studio-params-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'en.json'), JSON.stringify({ greet: 'Hi {name}' }, null, 2));
  writeFileSync(join(dir, 'es.json'), JSON.stringify({ greet: 'Hola {name}' }, null, 2));
  return resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });
}

function plural(): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-studio-plural-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  const one = '{n | one: one file | other: # files}';
  writeFileSync(join(dir, 'en.json'), JSON.stringify({ n: one }, null, 2));
  writeFileSync(join(dir, 'es.json'), JSON.stringify({ n: '{n | one: un archivo | other: # archivos}' }, null, 2));
  return resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('writeMessage', () => {
  it('clears the draft flag, because a human wrote it', async () => {
    const cfg = project({ es: ['hello', 'bye'] });
    const result = await writeMessage(cfg, 'es', 'hello', 'Buenas');

    expect(result.clearedDraft).toBe(true);
    expect(loadDrafts(cfg)).toEqual({ es: ['bye'] });
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).hello).toBe('Buenas');
  });

  it('refuses to touch the source locale', async () => {
    const cfg = project();
    await expect(writeMessage(cfg, 'en', 'hello', 'Hi')).rejects.toThrow(
      /source text lives in your code/,
    );
  });

  it('refuses a locale the project does not declare', async () => {
    const cfg = project();
    await expect(writeMessage(cfg, 'fr', 'hello', 'Salut')).rejects.toThrow(
      /not one of this project/,
    );
  });

  // A key is born from your code, so accepting one the source never had would invent it.
  it('refuses a key the source catalog does not have', async () => {
    const cfg = project();
    await expect(writeMessage(cfg, 'es', 'made.up', 'Algo')).rejects.toThrow(/will not create it/);
  });

  // Every other write path is gated by structure, so the one a person types cannot skip it.
  it('refuses a translation that lost a param the source has', async () => {
    const cfg = params();
    await expect(writeMessage(cfg, 'es', 'greet', 'Hola')).rejects.toThrow(/name/);
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).greet).toBe('Hola {name}');
  });

  it('accepts the same translation once the param is back', async () => {
    const cfg = params();
    await writeMessage(cfg, 'es', 'greet', 'Que tal, {name}');
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).greet).toBe('Que tal, {name}');
  });

  // Proved able to fail by using `key in source`, which walks Object.prototype and lets these in.
  it('refuses a key that only the prototype has', async () => {
    const cfg = project();
    for (const key of ['__proto__', 'toString', 'constructor']) {
      await expect(writeMessage(cfg, 'es', key, 'Algo')).rejects.toThrow(/will not create it/);
    }
  });

  // '' means untranslated across the whole cycle, so clearing a field is a real action.
  it('accepts an empty string and stops counting the key as a draft', async () => {
    const cfg = project({ es: ['hello'] });
    await writeMessage(cfg, 'es', 'hello', '');
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).hello).toBe('');
    expect(loadDrafts(cfg)).toEqual({});
  });

  // writeCatalog gives the file its shape back, so a dotted key lands inside its group.
  it('keeps a nested catalog nested', async () => {
    const cfg = nested();
    await writeMessage(cfg, 'es', 'nav.docs', 'Documentacion');
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8'))).toEqual({
      nav: { docs: 'Documentacion', home: 'Inicio' },
    });
  });
});

describe('writeMessage reads the text that ships (0.68.0)', () => {
  function owned(): ResolvedConfig {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-studio-owned-'));
    made.push(root);
    mkdirSync(join(root, 'locales'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    // the code moved to a text with a param, and nobody has run extract since
    writeFileSync(join(root, 'src', 'app.ts'), "export const x = t.id('greet')`Hello ${name}`;\n");
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ greet: 'Hello' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ greet: '' }));
    return resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });
  }

  // Proved able to fail by validating against the catalog: Studio saved what check calls broken.
  it('refuses a translation that cannot say what the code says', async () => {
    const cfg = owned();
    await expect(writeMessage(cfg, 'es', 'greet', 'Hola')).rejects.toThrow(/name/);
    await writeMessage(cfg, 'es', 'greet', 'Hola {name}');
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).greet).toBe('Hola {name}');
  });

  // Proved able to fail by leaving the stamp to the next extract: it took the newer source.
  it('stamps what a person saves for the text that ships, as it saves it', async () => {
    const cfg = owned();
    await writeMessage(cfg, 'es', 'greet', 'Hola {name}');
    const state = JSON.parse(readFileSync(join(cfg.dir, '.verbaly-state.json'), 'utf8'));
    expect(Object.keys(state.fingerprints.es)).toEqual(['greet']);
    expect(state.drafts).toBeUndefined();
  });

  it('saves nothing when the state cannot be read, since the draft flag would be lost', async () => {
    const cfg = owned();
    writeFileSync(join(cfg.dir, '.verbaly-state.json'), '<<<<<<< HEAD');
    await expect(writeMessage(cfg, 'es', 'greet', 'Hola {name}')).rejects.toThrow(/not valid JSON/);
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).greet).toBe('');
  });
});

describe('approve', () => {
  it('approves one key', () => {
    const cfg = project({ es: ['hello', 'bye'] });
    expect(approve(cfg, 'es', ['hello'])).toEqual({ locale: 'es', approved: 1, keys: ['hello'] });
    expect(loadDrafts(cfg)).toEqual({ es: ['bye'] });
  });

  it('approves the whole locale when no keys are given', () => {
    const cfg = project({ es: ['hello', 'bye'], de: ['hello'] });
    expect(approve(cfg, 'es')).toEqual({ locale: 'es', approved: 2, keys: ['hello', 'bye'] });
    expect(loadDrafts(cfg)).toEqual({ de: ['hello'] });
  });

  // Proved able to fail by replacing the save with saveDrafts(cfg, { es: remaining }).
  it('leaves every other locale alone', () => {
    const cfg = project({ es: ['hello', 'bye'], de: ['hello', 'bye'] });
    approve(cfg, 'es', ['hello']);
    expect(loadDrafts(cfg)).toEqual({ de: ['bye', 'hello'], es: ['bye'] });

    approve(cfg, 'es');
    expect(loadDrafts(cfg)).toEqual({ de: ['bye', 'hello'] });
  });

  // approve() takes no drafts argument so it cannot be handed the copy the panel painted with.
  it('reads the sidecar at approve time, not when the panel painted', () => {
    const cfg = project({ es: ['hello'] });
    const whenThePanelPainted = loadDrafts(cfg);
    expect(whenThePanelPainted).toEqual({ es: ['hello'] });

    const agent = loadDrafts(cfg);
    agent.de = ['hello', 'bye'];
    saveDrafts(cfg, agent);

    approve(cfg, 'es');
    expect(loadDrafts(cfg)).toEqual({ de: ['bye', 'hello'] });
  });
});

describe('buildState', () => {
  // Studio is what you open to fix a broken catalog, so one must not take the panel down.
  it('reports a catalog it cannot parse instead of throwing', async () => {
    const cfg = project();
    writeFileSync(join(cfg.dir, 'de.json'), '{ not json');

    const state = await buildState(cfg);
    expect(state.catalogs.de).toEqual({});
    expect(state.catalogs.es).toEqual({ hello: 'Hola', bye: 'Adios' });
    expect(state.problems.map((p) => p.scope)).toContain('de');
  });

  // include: [] is off, not "scanned and found none", and the panel says different things.
  it('says whether the project is scanned at all', async () => {
    const scanned = await buildState(project());
    expect(scanned.scanning).toBe(true);

    const cfg = project();
    const state = await buildState({ ...cfg, include: [] });
    expect(state.scanning).toBe(false);
  });

  // Proved able to fail by handing check()'s own unknown array through untouched.
  it('never sends the absolute path of the project to the browser', async () => {
    const cfg = project();
    mkdirSync(join(cfg.root, 'src'), { recursive: true });
    writeFileSync(join(cfg.root, 'src', 'app.ts'), "export const a = t('nope');");

    const state = await buildState(cfg);
    expect(state.check.unknown.map((entry) => entry.key)).toEqual(['nope']);
    expect(state.check.unknown[0]!.files).toEqual(['src/app.ts']);
  });

  // Proved able to fail by relativizing unknown only: extra carries the absolute path through.
  it('sends the files of a key only a translation has as project paths too', async () => {
    const cfg = project();
    writeFileSync(
      join(cfg.dir, 'es.json'),
      JSON.stringify({ hello: 'Hola', bye: 'Adios', solo: 'Solo' }),
    );
    mkdirSync(join(cfg.root, 'src'), { recursive: true });
    writeFileSync(join(cfg.root, 'src', 'app.ts'), "export const a = t('solo');");

    const state = await buildState(cfg);
    expect(state.check.extra).toEqual([{ locale: 'es', key: 'solo', files: ['src/app.ts'] }]);
  });
});

describe('the write gate is the gate, not half of it', () => {
  // Proved able to fail by dropping validateMessage: check() rejects what Studio had accepted.
  it('refuses a plural block with no other case, which validatePair alone cannot see', async () => {
    const cfg = plural();
    await expect(writeMessage(cfg, 'es', 'n', '{n | one: un archivo}')).rejects.toThrow(
      /"other" case/,
    );
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).n).toContain('archivos');
  });

  // Proved able to fail by validating `text` instead of the trimmed value.
  it('stores whitespace as the untranslated empty string, never as a translation', async () => {
    const cfg = params();
    await writeMessage(cfg, 'es', 'greet', '   ');
    expect(JSON.parse(readFileSync(join(cfg.dir, 'es.json'), 'utf8')).greet).toBe('');
  });
});

describe('buildState degrades on every file it reads, not just the catalogs', () => {
  // Proved able to fail by calling loadDrafts directly: it throws and the whole panel 500s.
  it('reports a state sidecar it cannot parse instead of throwing', async () => {
    const cfg = project();
    writeFileSync(join(cfg.dir, '.verbaly-state.json'), '{ not json');

    const state = await buildState(cfg);
    expect(state.drafts).toEqual({});
    expect(state.problems.map((p) => p.scope)).toContain('.verbaly-state.json');
  });

  // Proved able to fail by pushing the file registry.parseErrors() reports, which is absolute.
  it('names an unparseable source file by its path inside the project', async () => {
    const cfg = project();
    mkdirSync(join(cfg.root, 'src'), { recursive: true });
    writeFileSync(join(cfg.root, 'src', 'bad.ts'), 'const = ;;;\n');

    const state = await buildState(cfg);
    expect(state.problems.map((p) => p.scope)).toContain('src/bad.ts');
  });
});

// Proved able to fail by dropping the existsSync check: --root at a typo reported nothing at all.
it('says so when there are no catalogs where it was pointed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-studio-empty-'));
  made.push(root);
  const cfg = resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });

  const state = await buildState(cfg);
  expect(state.problems.map((p) => p.scope)).toContain('locales');
  expect(state.problems[0]!.message).toContain('check --root');
});

describe('undo, because the flag records who wrote the text', () => {
  // Proved able to fail by returning the keys asked for: undo puts back one that never was.
  it('reports the keys it really cleared, not the ones it was asked about', () => {
    const cfg = project({ es: ['hello'] });
    expect(approve(cfg, 'es', ['hello', 'never-was-a-draft'])).toEqual({
      locale: 'es',
      approved: 1,
      keys: ['hello'],
    });
  });

  it('puts back exactly what it cleared, and the file comes back identical', () => {
    const cfg = project({ es: ['hello', 'bye'], de: ['hello'] });
    // saveDrafts sorts and dedupes, so the baseline is what it writes, not what the fixture wrote
    approve(cfg, 'de', []);
    const before = readFileSync(join(cfg.dir, '.verbaly-state.json'), 'utf8');

    const done = approve(cfg, 'es');
    expect(loadDrafts(cfg)).toEqual({ de: ['hello'] });

    unapprove(cfg, 'es', done.keys);
    expect(loadDrafts(cfg)).toEqual({ de: ['hello'], es: ['bye', 'hello'] });
    expect(readFileSync(join(cfg.dir, '.verbaly-state.json'), 'utf8')).toBe(before);
  });

  it('refuses a locale the project does not declare', () => {
    const cfg = project();
    expect(() => unapprove(cfg, 'fr', ['hello'])).toThrow(/not one of this project/);
  });
});
