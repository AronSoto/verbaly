import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config/config';
import { loadState, STATE_FILE } from '../src/catalog/state';
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
