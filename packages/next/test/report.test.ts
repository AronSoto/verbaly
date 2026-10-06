import * as compiler from '@verbaly/compiler';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportDev, resetReported } from '../src/report';

const COMPILER_TIMEOUT = 30_000;

function project() {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-next-report-'));
  return compiler.resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
}

function registryOf(files: Record<string, string>): compiler.MessageRegistry {
  const registry = new compiler.MessageRegistry();
  for (const [file, code] of Object.entries(files)) {
    compiler.transformSource(code, file, registry);
  }
  return registry;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetReported();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const said = (): string[] => warn.mock.calls.map(([line]: unknown[]) => String(line));

// every test here loads the real ESM compiler through the alias: not a 5s job under pnpm test
describe('reportDev', { timeout: COMPILER_TIMEOUT }, () => {
  it('says a collision once while its text is being typed, not once per keystroke', () => {
    const cfg = project();
    for (const text of ['C', 'Ch', 'Cha', 'Chau']) {
      const registry = registryOf({
        [join(cfg.root, 'a.ts')]: "t.id('typing')`Hola`;",
        [join(cfg.root, 'b.ts')]: `t.id('typing')\`${text}\`;`,
      });
      reportDev(compiler, cfg, registry, [], undefined, []);
    }
    expect(said().filter((line) => line.includes('typing'))).toHaveLength(1);
  });

  it('tells an edit in the catalog from an edit in the code', () => {
    const cfg = project();
    const file = join(cfg.root, 'a.ts');
    const first = registryOf({ [file]: "t.id('greet')`Hello`;" });
    const texts = reportDev(compiler, cfg, first, [], undefined, []);

    // the code still says Hello, so the catalog was edited by hand and the code wins
    reportDev(compiler, cfg, first, ['greet'], texts, []);
    expect(said()).toEqual([
      '[verbaly] en.json: your edit of "greet" was replaced, its text lives in a.ts: change it there',
    ]);

    warn.mockClear();
    resetReported();
    // the code moved to Hi: that is how a text it owns gets edited, nothing to say
    const second = registryOf({ [file]: "t.id('greet')`Hi`;" });
    reportDev(compiler, cfg, second, ['greet'], texts, []);
    expect(said()).toEqual([]);
  });

  it('at startup says which catalog text the code wrote, since it cannot know who moved', () => {
    const cfg = project();
    const registry = registryOf({ [join(cfg.root, 'a.ts')]: "t.id('greet')`Hello`;" });
    reportDev(compiler, cfg, registry, ['greet'], undefined, []);
    expect(said()).toEqual([
      '[verbaly] en.json: "greet" took the text written in a.ts, the code owns it',
    ]);
  });

  it('names an outdated translation and a renamed t once each', () => {
    const cfg = project();
    const registry = registryOf({ [join(cfg.root, 'a.ts')]: 'const tr = useT(); tr`Hidden`;' });
    const outdated = [{ locale: 'es', key: 'bio' }];
    reportDev(compiler, cfg, registry, [], undefined, outdated);
    reportDev(compiler, cfg, registry, [], undefined, outdated);
    expect(said()).toEqual([
      '[verbaly] a.ts: tr`…` is never extracted, so it stays in the source language: name it t',
      '[verbaly] es: "bio" was translated from an older source text, update it or approve it',
    ]);
  });
});
