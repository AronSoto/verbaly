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
