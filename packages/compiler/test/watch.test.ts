import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config';
import { watchProject, watchTree } from '../src/watch';

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-watch-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  writeFileSync(join(root, 'locales', 'en.json'), '{}');
  mkdirSync(join(root, 'src'));
  return resolveConfig({ root });
}

describe('watchProject', () => {
  it('runs on source changes and ignores catalog and dts writes', async () => {
    const cfg = makeProject();
    let runs = 0;
    const stop = watchProject(
      cfg,
      async () => {
        runs += 1;
      },
      { debounce: 10 },
    );
    try {
      writeFileSync(join(cfg.root, 'src', 'app.ts'), 't`Hola`;');
      await vi.waitFor(() => expect(runs).toBeGreaterThan(0), { timeout: 5000 });
      const settled = runs;
      writeFileSync(join(cfg.root, 'locales', 'en.json'), '{"a":"A"}');
      writeFileSync(join(cfg.root, 'verbaly.d.ts'), 'declare const x: string;');
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(runs).toBe(settled);
    } finally {
      stop();
    }
  });

  it('queues a change that lands mid-run and re-runs after', async () => {
    const cfg = makeProject();
    let runs = 0;
    const stop = watchProject(
      cfg,
      async () => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 400));
      },
      { debounce: 10 },
    );
    try {
      writeFileSync(join(cfg.root, 'src', 'a.ts'), 't`a`;');
      await vi.waitFor(() => expect(runs).toBe(1), { timeout: 5000 });
      // the first run is still sleeping: this change must queue, not get lost
      writeFileSync(join(cfg.root, 'src', 'b.ts'), 't`b`;');
      await vi.waitFor(() => expect(runs).toBe(2), { timeout: 5000 });
    } finally {
      stop();
    }
  });

  it('survives a failing run and keeps watching', async () => {
    const cfg = makeProject();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let runs = 0;
    const stop = watchProject(
      cfg,
      async () => {
        runs += 1;
        if (runs === 1) throw new Error('boom');
      },
      { debounce: 10 },
    );
    try {
      writeFileSync(join(cfg.root, 'src', 'a.ts'), 't`a`;');
      await vi.waitFor(() => expect(runs).toBe(1), { timeout: 5000 });
      await vi.waitFor(() =>
        expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('watch run failed'),
      );
      writeFileSync(join(cfg.root, 'src', 'b.ts'), 't`b`;');
      await vi.waitFor(() => expect(runs).toBe(2), { timeout: 5000 });
    } finally {
      stop();
      warn.mockRestore();
    }
  });

  it('coalesces a burst of changes into one run', async () => {
    const cfg = makeProject();
    let runs = 0;
    const stop = watchProject(
      cfg,
      async () => {
        runs += 1;
      },
      { debounce: 150 },
    );
    try {
      for (let i = 0; i < 5; i += 1) {
        writeFileSync(join(cfg.root, 'src', `f${i}.ts`), 't`x`;');
      }
      await vi.waitFor(() => expect(runs).toBeGreaterThan(0), { timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(runs).toBe(1);
    } finally {
      stop();
    }
  });
});

// forced by hand on every platform: it is the one that runs where Node cannot watch a tree
describe('watchTree without a native tree watch', { timeout: 15_000 }, () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const close of closers.splice(0)) close();
  });

  function tree(options: { keep?: string } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-tree-'));
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.next'));
    mkdirSync(join(root, '.i18n'));
    const seen: string[] = [];
    const record = (file: string) => seen.push(file.split(sep).join('/'));
    closers.push(watchTree(root, { native: false, ...options }, record));
    return { root, seen };
  }

  // Proved able to fail by fanning out to every directory: node_modules reports its change.
  it('reports code at any depth, and never walks node_modules or a dot directory', async () => {
    const { root, seen } = tree({ keep: '.i18n' });
    await vi.waitFor(
      () => {
        writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), String(Date.now()));
        writeFileSync(join(root, '.next', 'trace.js'), String(Date.now()));
        writeFileSync(join(root, 'src', 'deep', 'page.tsx'), String(Date.now()));
        writeFileSync(join(root, '.i18n', 'en.json'), String(Date.now()));
        expect(seen).toContain('src/deep/page.tsx');
        expect(seen).toContain('.i18n/en.json');
      },
      { timeout: 5000, interval: 100 },
    );
    expect(seen.filter((file) => /^(node_modules|[.]next)[/]/.test(file))).toEqual([]);
  });

  // Proved able to fail by dropping the top-level sync: a directory made later is never heard.
  it('starts watching a top-level directory made after it started', async () => {
    const { root, seen } = tree();
    mkdirSync(join(root, 'app'));
    await vi.waitFor(
      () => {
        writeFileSync(join(root, 'app', 'page.tsx'), String(Date.now()));
        expect(seen).toContain('app/page.tsx');
      },
      { timeout: 5000, interval: 100 },
    );
  });

  // Proved able to fail by keeping the first watcher: the src made again never reports.
  it('watches a directory again once it is removed and made again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { root, seen } = tree();
    rmSync(join(root, 'src'), { recursive: true, force: true });
    mkdirSync(join(root, 'src'));
    await vi.waitFor(
      () => {
        writeFileSync(join(root, 'src', 'again.tsx'), String(Date.now()));
        expect(seen).toContain('src/again.tsx');
      },
      { timeout: 5000, interval: 100 },
    );
  });
});
