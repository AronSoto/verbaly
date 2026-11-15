import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, targetLocales } from '../src/config/config';
import { loadState, STATE_FILE } from '../src/catalog/lock';
import type { TranslateProvider, TranslateRequest } from '../src/exchange/translate';
import { writeDrafts } from '../src/exchange/translate';
import { translateProject } from '../src/project/translate';

const echo: TranslateProvider = async ({ messages }: TranslateRequest) =>
  Object.fromEntries(Object.entries(messages).map(([key, text]) => [key, `[x] ${text}`]));

function project(provider: TranslateProvider = echo, es: Record<string, string> = { bye: '' }) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-run-'));
  mkdirSync(join(root, 'locales'));
  const write = (locale: string, catalog: Record<string, string>): void =>
    writeFileSync(join(root, 'locales', `${locale}.json`), JSON.stringify(catalog, null, 2));
  write('en', { hi: 'Hi {name}', bye: 'Bye' });
  write('es', { hi: 'Hola {name}', ...es });
  return resolveConfig({ root, locales: ['es'], include: [], translate: { provider } });
}

const catalog = (cfg: { dir: string }, locale: string): Record<string, string> =>
  JSON.parse(readFileSync(join(cfg.dir, `${locale}.json`), 'utf8'));

describe('translateProject, the one translate run', () => {
  it('writes what answered as drafts, stamps it, and says the lock it created', async () => {
    const cfg = project();
    const result = await translateProject(cfg);
    expect(result.written).toEqual({ es: ['bye'] });
    expect(result.kept).toEqual({});
    expect(result.failed).toEqual([]);
    expect(catalog(cfg, 'es').bye).toBe('[x] Bye');
    expect(loadState(cfg).drafts).toEqual({ es: ['bye'] });
    expect(result.lock).toEqual({ file: join(cfg.root, STATE_FILE) });
    // the lock is there now, so a second run has no news about it
    expect((await translateProject(cfg)).lock).toBeUndefined();
  });

  it('lists what a dry run would send, and neither calls the provider nor writes', async () => {
    let calls = 0;
    const cfg = project(async (request) => {
      calls += 1;
      return echo(request);
    });
    const result = await translateProject(cfg, { dryRun: true });
    expect(result.pending).toEqual({ es: ['bye'] });
    expect(result.written).toEqual({});
    expect(calls).toBe(0);
    expect(catalog(cfg, 'es').bye).toBe('');
    expect(existsSync(join(cfg.root, STATE_FILE))).toBe(false);
  });

  it('stops before the provider when the lock cannot be read, since a draft would pass as read', async () => {
    let calls = 0;
    const cfg = project(async (request) => {
      calls += 1;
      return echo(request);
    });
    writeFileSync(join(cfg.root, STATE_FILE), '{ not json');
    await expect(translateProject(cfg)).rejects.toThrow(/not valid JSON/);
    expect(calls).toBe(0);
    expect(catalog(cfg, 'es').bye).toBe('');
  });

  it('keeps a text someone saved while the provider worked, and reports it apart', async () => {
    const cfg = project(async (request) => {
      writeFileSync(
        join(cfg.dir, 'es.json'),
        JSON.stringify({ hi: 'Hola {name}', bye: 'Adiós' }, null, 2),
      );
      return echo(request);
    });
    const result = await translateProject(cfg);
    expect(result.written).toEqual({});
    expect(result.kept).toEqual({ es: ['bye'] });
    expect(catalog(cfg, 'es').bye).toBe('Adiós');
  });

  it('hands every batch to onProgress, and a failed one lands in failed with the rest written', async () => {
    const seen: string[] = [];
    const cfg = project(async () => {
      throw Object.assign(new Error('the api refused it'), { status: 400 });
    });
    const result = await translateProject(cfg, {
      onProgress: (progress) => seen.push(`${progress.locale}:${progress.error ?? 'ok'}`),
    });
    expect(seen).toEqual(['es:the api refused it']);
    expect(result.failed).toEqual([{ locale: 'es', keys: ['bye'], error: 'the api refused it' }]);
    expect(result.written).toEqual({});
  });
});

// one batch at a time, so es has landed before the provider is asked for pt
function two(provider: TranslateProvider) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-run-'));
  mkdirSync(join(root, 'locales'));
  const files = { en: { hi: 'Hi', bye: 'Bye' }, es: {}, pt: {} };
  for (const [locale, messages] of Object.entries(files)) {
    writeFileSync(join(root, 'locales', `${locale}.json`), JSON.stringify(messages, null, 2));
  }
  const translate = { provider, concurrency: 1 };
  return resolveConfig({ root, locales: ['es', 'pt'], include: [], translate });
}

// Proved able to fail with one save at the end of the run, and with the text before its mark
describe('translateProject saves a language as soon as it is whole', () => {
  it('has es on disk, marked as drafts, while pt is still on its way', async () => {
    let seen: unknown;
    const cfg = two(async (request) => {
      if (request.targetLocale === 'pt') {
        seen = { es: catalog(cfg, 'es'), drafts: { ...loadState(cfg).drafts } };
      }
      return echo(request);
    });
    const result = await translateProject(cfg);
    expect(seen).toEqual({ es: { bye: '[x] Bye', hi: '[x] Hi' }, drafts: { es: ['bye', 'hi'] } });
    expect(result.written).toEqual({ es: ['bye', 'hi'], pt: ['bye', 'hi'] });
    expect(result.lock).toEqual({ file: join(cfg.root, STATE_FILE) });
  });

  it('lists the languages in the order of the project, whichever answered first', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((done) => (release = done));
    const root = mkdtempSync(join(tmpdir(), 'verbaly-run-'));
    mkdirSync(join(root, 'locales'));
    for (const [locale, messages] of Object.entries({ en: { hi: 'Hi' }, es: {}, pt: {} })) {
      writeFileSync(join(root, 'locales', `${locale}.json`), JSON.stringify(messages));
    }
    // es is held back on purpose until pt has landed
    const provider: TranslateProvider = async (request) => {
      if (request.targetLocale === 'es') await held;
      return echo(request);
    };
    const cfg = resolveConfig({
      root,
      locales: ['es', 'pt'],
      include: [],
      translate: { provider },
    });
    const landed: string[] = [];
    const result = await translateProject(cfg, {
      onProgress: (progress) => {
        landed.push(progress.locale);
        release();
      },
    });
    expect(landed).toEqual(['pt', 'es']);
    expect(Object.keys(result.written)).toEqual(['es', 'pt']);
  });

  it('says nothing about a lock another process made while a run that saved nothing was out', async () => {
    const cfg = project(async () => {
      // someone else's save, while the provider works: the run itself will land nothing
      writeFileSync(join(cfg.root, STATE_FILE), JSON.stringify({ version: 1, drafts: {} }));
      throw Object.assign(new Error('the api refused it'), { status: 400 });
    });
    const result = await translateProject(cfg);
    expect(result.written).toEqual({});
    expect(existsSync(join(cfg.root, STATE_FILE))).toBe(true);
    expect(result.lock).toBeUndefined();
  });

  it('reports a language whose file cannot be saved as failed, and the rest land as drafts', async () => {
    const cfg = two(async (request) => {
      // a folder where pt.json was: that write fails on every system, whoever runs the suite
      if (request.targetLocale === 'pt') {
        rmSync(join(cfg.dir, 'pt.json'));
        mkdirSync(join(cfg.dir, 'pt.json'));
      }
      return echo(request);
    });
    const result = await translateProject(cfg);
    expect(result.written).toEqual({ es: ['bye', 'hi'] });
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]).toMatchObject({ locale: 'pt', keys: ['bye', 'hi'] });
    expect(result.failed[0]!.error).toMatch(/^could not be saved: /);
    expect(catalog(cfg, 'es')).toEqual({ bye: '[x] Bye', hi: '[x] Hi' });
    expect(loadState(cfg).drafts.es).toEqual(['bye', 'hi']);
  });

  it('saves the draft mark before the text: a lock that cannot be written leaves no translation', async () => {
    const cfg = project();
    // a folder where the lock goes: it reads as no lock, and no save can write it
    mkdirSync(join(cfg.root, STATE_FILE));
    const result = await translateProject(cfg);
    expect(result.written).toEqual({});
    expect(result.failed).toMatchObject([{ locale: 'es', keys: ['bye'] }]);
    expect(catalog(cfg, 'es').bye).toBe('');
  });

  it('gives writeDrafts the same order: no mark saved, no text written', () => {
    const cfg = project();
    mkdirSync(join(cfg.root, STATE_FILE));
    expect(() => writeDrafts(cfg, 'es', [{ key: 'bye', text: 'Adiós' }])).toThrow();
    expect(catalog(cfg, 'es').bye).toBe('');
  });
});

// Proved able to fail with the silent filter back: a typo read as a language with nothing to do
describe('a language the project does not have is an error, whoever names it', () => {
  it('stops a translate run before the provider, dry or not, listing the languages it has', async () => {
    let calls = 0;
    const cfg = project(async (request) => {
      calls += 1;
      return echo(request);
    });
    for (const dryRun of [true, false]) {
      await expect(translateProject(cfg, { locales: ['ess'], dryRun })).rejects.toThrow(
        /locales names "ess", and this project has en, es\n {4}fix: check the spelling, or add ess to locales in your verbaly config to start a new language/,
      );
    }
    expect(calls).toBe(0);
    expect(existsSync(join(cfg.dir, 'ess.json'))).toBe(false);
  });

  it('gives writeDrafts the same answer, and keeps its own for the source language', () => {
    const cfg = project();
    expect(() => writeDrafts(cfg, 'ess', [{ key: 'bye', text: 'Adiós' }])).toThrow(
      /locale names "ess", and this project has en, es\n {4}fix: check the spelling/,
    );
    expect(() => writeDrafts(cfg, 'en', [{ key: 'bye', text: 'Bye!' }])).toThrow(
      '"en" is not a language this project translates into (es)',
    );
  });

  it('is what targetLocales answers to a name, while the source language is only left out', () => {
    const cfg = project();
    expect(targetLocales(cfg)).toEqual(['es']);
    expect(targetLocales(cfg, ['en', 'es'])).toEqual(['es']);
    expect(() => targetLocales(cfg, ['es', 'fr'])).toThrow(/locales names "fr"/);
  });
});

describe('writeDrafts says the lock it created', () => {
  it('returns the lock on the save that brought it into being, and only then', () => {
    const cfg = project();
    const first = writeDrafts(cfg, 'es', [{ key: 'bye', text: 'Adiós' }]);
    expect(first.written).toEqual(['bye']);
    expect(first.lock).toEqual({ file: join(cfg.root, STATE_FILE) });
    const again = writeDrafts(cfg, 'es', [{ key: 'bye', text: 'Chao' }], { overwrite: true });
    expect(again.written).toEqual(['bye']);
    expect(again.lock).toBeUndefined();
  });
});
