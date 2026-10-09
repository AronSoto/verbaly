import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withVerbaly, type NextConfigLike } from '../src/index';

const asked: string[] = [];

// Yarn PnP has no node_modules: the project's own resolver is the one that knows where next is
vi.mock('node:module', async (original) => ({
  ...(await original<typeof import('node:module')>()),
  createRequire: () => ({
    resolve: (id: string) => {
      asked.push(id);
      return `/pnp/${id}`;
    },
  }),
}));

describe('the build gate under Yarn PnP', { timeout: 30_000 }, () => {
  afterEach(() => {
    delete (process.versions as Record<string, unknown>).pnp;
  });

  // Proved able to fail by walking node_modules alone: the gate ran at config load, typegen broke.
  it('asks the project resolver for the hook, so next typegen still loads past the gate', async () => {
    Object.defineProperty(process.versions, 'pnp', { value: '3', configurable: true });
    const root = mkdtempSync(join(tmpdir(), 'verbaly-next-pnp-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'locales'), { recursive: true });
    writeFileSync(join(root, 'src', 'page.tsx'), 'export const s = t`Hello`;');
    writeFileSync(join(root, 'locales', 'en.json'), '{}');
    writeFileSync(join(root, 'locales', 'es.json'), '{}');

    // failOnMissing: true, the one setting where the gate can still stop a build
    const config = await withVerbaly<NextConfigLike>(
      {},
      { root, sourceLocale: 'en', locales: ['en', 'es'], failOnMissing: true },
    )('phase-production-build');
    expect(asked).toContain('next/dist/build/after-production-compile.js');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const hook = config.compiler?.runAfterProductionCompile as () => Promise<void>;
      await expect(hook()).rejects.toThrow(/build blocked/);
    } finally {
      error.mockRestore();
    }
  });
});
