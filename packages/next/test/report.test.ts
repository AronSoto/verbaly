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

type Config = ReturnType<typeof project>;

function registryOf(files: Record<string, string>): compiler.MessageRegistry {
  const registry = new compiler.MessageRegistry();
  for (const [file, code] of Object.entries(files)) {
    compiler.transformSource(code, file, registry);
  }
  return registry;
}

// what syncProject hands the reporter, without touching the disk
async function run(
  cfg: Config,
  registry: compiler.MessageRegistry,
  catalogs: compiler.Catalogs = { en: {}, es: {} },
  extra: Partial<compiler.SyncProjectResult> = {},
): Promise<compiler.SyncProjectResult> {
  const result = await compiler.syncProject(cfg, { registry, catalogs, dryRun: true });
  return { ...result, ...extra };
}

const stamp = (source: string, translated: string) =>
  `${compiler.stableKey(source)}.${compiler.stableKey(translated)}`;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetReported();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

const said = (): string[] => warn.mock.calls.map(([line]: unknown[]) => String(line));

// every test here loads the real ESM compiler through the alias: not a 5s job under pnpm test
describe('reportDev', { timeout: COMPILER_TIMEOUT }, () => {
  it('says a collision once while its text is being typed, not once per keystroke', async () => {
    const cfg = project();
    for (const text of ['C', 'Ch', 'Cha', 'Chau']) {
      const registry = registryOf({
        [join(cfg.root, 'a.ts')]: "t.id('typing')`Hola`;",
        [join(cfg.root, 'b.ts')]: `t.id('typing')\`${text}\`;`,
      });
      reportDev(compiler, cfg, await run(cfg, registry), undefined);
    }
    expect(said().filter((line) => line.includes('typing'))).toHaveLength(1);
  });

  it('tells an edit in the catalog from an edit in the code', async () => {
    const cfg = project();
    const file = join(cfg.root, 'a.ts');
    const first = registryOf({ [file]: "t.id('greet')`Hello`;" });
    const texts = reportDev(
      compiler,
      cfg,
      await run(cfg, first, { en: { greet: 'Hello' } }),
      undefined,
    );

    // the code still says Hello, so the catalog was edited by hand and the code wins
    reportDev(compiler, cfg, await run(cfg, first, { en: { greet: 'Edited' } }), texts);
    expect(said()).toEqual([
      '[verbaly] en.json: your edit of "greet" was replaced, its text lives in a.ts:1: change it there',
    ]);

    warn.mockClear();
    // the code moved to Hi: that is how a text it owns gets edited, nothing to say
    const second = registryOf({ [file]: "t.id('greet')`Hi`;" });
    reportDev(compiler, cfg, await run(cfg, second, { en: { greet: 'Hello' } }), texts);
    expect(said()).toEqual([]);
  });

  it('at startup says which catalog text the code wrote, since it cannot know who moved', async () => {
    const cfg = project();
    const registry = registryOf({ [join(cfg.root, 'a.ts')]: "t.id('greet')`Hello`;" });
    reportDev(compiler, cfg, await run(cfg, registry, { en: { greet: 'Edited' } }), undefined);
    expect(said()).toEqual([
      '[verbaly] en: greet follows the code (a.ts:1): "Hello", was "Edited"',
    ]);
  });

  it('names an outdated translation and a renamed t once each, at their lines', async () => {
    const cfg = project();
    const registry = registryOf({ [join(cfg.root, 'a.ts')]: 'const tr = useT();\ntr`Hidden`;' });
    const catalogs = { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } };
    const state = {
      drafts: {},
      fingerprints: { es: { bio: stamp('I write code', 'Escribo código') } },
    };
    const result = await run(cfg, registry, catalogs, { state });
    reportDev(compiler, cfg, result, undefined);
    reportDev(compiler, cfg, result, undefined);
    expect(said()).toEqual([
      '[verbaly] a.ts:2: tr`…` is never extracted, so it stays in the source language: name it t',
      '[verbaly] [es] bio: translated from an older source text, update it or keep it with `npx verbaly review --approve`',
    ]);
  });

  // Proved able to fail by remembering each warning for the server's life: it never came back.
  it('says it again when a fixed problem comes back', async () => {
    const cfg = project();
    const registry = registryOf({});
    const catalogs = { en: { bio: 'I write software' }, es: { bio: 'Escribo código' } };
    const stale = {
      drafts: {},
      fingerprints: { es: { bio: stamp('I write code', 'Escribo código') } },
    };
    const fresh = { drafts: {}, fingerprints: {} };
    reportDev(compiler, cfg, await run(cfg, registry, catalogs, { state: stale }), undefined);
    reportDev(compiler, cfg, await run(cfg, registry, catalogs, { state: fresh }), undefined);
    reportDev(compiler, cfg, await run(cfg, registry, catalogs, { state: stale }), undefined);
    expect(said().filter((line) => line.includes('[es] bio'))).toHaveLength(2);
  });

  // Proved able to fail with no cap: a project with dozens of stale translations flooded next dev.
  it('says a few at a time and counts the rest', async () => {
    const cfg = project();
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const catalogs = {
      en: Object.fromEntries(keys.map((key) => [key, `New ${key}`])),
      es: Object.fromEntries(keys.map((key) => [key, `Viejo ${key}`])),
    };
    const fingerprints = {
      es: Object.fromEntries(keys.map((key) => [key, stamp(`Old ${key}`, `Viejo ${key}`)])),
    };
    const result = await run(cfg, registryOf({}), catalogs, {
      state: { drafts: {}, fingerprints },
    });
    reportDev(compiler, cfg, result, undefined);
    expect(said()).toHaveLength(6);
    expect(said()[5]).toBe('[verbaly] and 2 more: `npx verbaly doctor` names them');
  });

  it('says a broken state file once, and again if it breaks after being fixed', async () => {
    const cfg = project();
    const registry = registryOf({});
    const broken = { stateProblem: 'locales/.verbaly-state.json is not valid JSON' };
    reportDev(compiler, cfg, await run(cfg, registry, undefined, broken), undefined);
    reportDev(compiler, cfg, await run(cfg, registry, undefined, broken), undefined);
    reportDev(compiler, cfg, await run(cfg, registry), undefined);
    reportDev(compiler, cfg, await run(cfg, registry, undefined, broken), undefined);
    expect(said().filter((line) => line.includes('not valid JSON'))).toHaveLength(2);
  });
});
