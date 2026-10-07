import * as compiler from '@verbaly/compiler';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatedDir } from '../src/codegen';
import { startWatcher, stopWatcher } from '../src/watch';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) stopWatcher(root);
  vi.restoreAllMocks();
});

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-next-watch-'));
  mkdirSync(join(root, 'locales'));
  writeFileSync(join(root, 'locales', 'en.json'), '{}');
  mkdirSync(join(root, 'src'));
  roots.push(root);
  return compiler.resolveConfig({ root, sourceLocale: 'en', locales: ['en'] });
}

const COMPILER_TIMEOUT = 30_000;

// a loaded machine delays the sync's own follow-up refresh, so wait until the count stops moving
async function quiet(count: () => number, window = 600, limit = 10_000): Promise<number> {
  const until = Date.now() + limit;
  let last = count();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, window));
    const now = count();
    if (now === last || Date.now() > until) return now;
    last = now;
  }
}

describe('startWatcher', { timeout: COMPILER_TIMEOUT }, () => {
  it('re-extracts on a source change and regenerates the runtime modules', async () => {
    const cfg = makeProject();
    startWatcher(compiler, cfg, {});
    writeFileSync(join(cfg.root, 'src', 'page.tsx'), 'export const x = t`Fresh text`;\n');
    await vi.waitFor(
      () => {
        const en = JSON.parse(readFileSync(join(cfg.root, 'locales', 'en.json'), 'utf8')) as Record<
          string,
          string
        >;
        expect(Object.values(en)).toContain('Fresh text');
      },
      { timeout: 5000 },
    );
    await vi.waitFor(
      () => expect(existsSync(join(generatedDir(cfg.root), 'index.js'))).toBe(true),
      { timeout: 5000 },
    );
  });

  it('is one watcher per root: a second start returns the existing dispose', () => {
    const cfg = makeProject();
    const dispose = startWatcher(compiler, cfg, {});
    expect(startWatcher(compiler, cfg, {})).toBe(dispose);
  });

  it('warns and keeps running when extraction fails', async () => {
    const cfg = makeProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const failing = {
      ...compiler,
      extractProject: async (config: compiler.ResolvedConfig) => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        return compiler.extractProject(config);
      },
    } as typeof compiler;
    startWatcher(failing, cfg, {});
    writeFileSync(join(cfg.root, 'src', 'a.tsx'), 'export const a = t`One`;\n');
    await vi.waitFor(
      () =>
        expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(
          'live extraction paused: boom',
        ),
      { timeout: 5000 },
    );
    writeFileSync(join(cfg.root, 'src', 'b.tsx'), 'export const b = t`Two`;\n');
    await vi.waitFor(() => expect(calls).toBeGreaterThan(1), { timeout: 5000 });
  });

  // Proved able to fail with the old warn: it printed the Error with a stack and a code frame.
  it('says in one line why a catalog saved with broken JSON paused it', async () => {
    const cfg = makeProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startWatcher(compiler, cfg, {});
    writeFileSync(join(cfg.root, 'locales', 'en.json'), '{ "half": ');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled(), { timeout: 5000 });
    const [line, ...rest] = warn.mock.calls[0]!;
    expect(rest).toEqual([]);
    expect(String(line)).toMatch(
      /^\[verbaly\] live extraction paused: .*en\.json is not valid JSON/,
    );
    expect(String(line)).not.toContain('\n');
  });

  it('queues a change landing mid-run instead of dropping it', async () => {
    const cfg = makeProject();
    let runs = 0;
    const slow = {
      ...compiler,
      extractProject: async (config: compiler.ResolvedConfig) => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return compiler.extractProject(config);
      },
    } as typeof compiler;
    startWatcher(slow, cfg, {});
    writeFileSync(join(cfg.root, 'src', 'a.tsx'), 'export const a = t`One`;\n');
    await vi.waitFor(() => expect(runs).toBe(1), { timeout: 5000 });
    // first run sleeps: this change must queue and produce a second run
    writeFileSync(join(cfg.root, 'src', 'b.tsx'), 'export const b = t`Two`;\n');
    await vi.waitFor(() => expect(runs).toBe(2), { timeout: 8000 });
  });

  it('ignores its own generated writes and catalog noise it did not cause', async () => {
    const cfg = makeProject();
    let runs = 0;
    const counting = {
      ...compiler,
      extractProject: async (config: compiler.ResolvedConfig) => {
        runs += 1;
        return compiler.extractProject(config);
      },
    } as typeof compiler;
    startWatcher(counting, cfg, {});
    writeFileSync(join(cfg.root, 'src', 'a.tsx'), 'export const a = t`One`;\n');
    await vi.waitFor(() => expect(runs).toBeGreaterThan(0), { timeout: 5000 });
    const settled = await quiet(() => runs);
    // .verbaly, .next, node_modules and .d.ts writes must never retrigger
    mkdirSync(join(cfg.root, '.next'), { recursive: true });
    writeFileSync(join(cfg.root, '.next', 'trace.js'), '');
    mkdirSync(join(cfg.root, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(cfg.root, 'node_modules', 'x', 'index.js'), '');
    writeFileSync(join(cfg.root, 'verbaly.d.ts'), 'declare const x: 1;\n');
    // the state sidecar this pipeline writes sits in the catalog directory and changes no message
    writeFileSync(join(cfg.root, 'locales', '.verbaly-state.json'), '{"drafts":{}}');
    expect(await quiet(() => runs)).toBe(settled);
  });

  it('a catalog edit triggers a refresh', async () => {
    const cfg = makeProject();
    let runs = 0;
    const counting = {
      ...compiler,
      extractProject: async (config: compiler.ResolvedConfig) => {
        runs += 1;
        return compiler.extractProject(config);
      },
    } as typeof compiler;
    startWatcher(counting, cfg, {});
    writeFileSync(join(cfg.root, 'locales', 'en.json'), '{"hand":"Edited"}');
    await vi.waitFor(() => expect(runs).toBeGreaterThan(0), { timeout: 5000 });
  });

  it('stopWatcher is safe on an unknown root', () => {
    expect(() => stopWatcher(join(tmpdir(), 'never-watched'))).not.toThrow();
  });
});
