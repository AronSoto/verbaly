import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config';
import { watchProject } from '../src/watch';

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
