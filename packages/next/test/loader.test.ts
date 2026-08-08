import { describe, expect, it, vi } from 'vitest';
import loader, { type LoaderContext } from '../src/loader';

interface LoaderResult {
  code?: string;
  map?: unknown;
}

function run(source: string, resourcePath: string): Promise<LoaderResult> {
  return new Promise((resolve, reject) => {
    const context: LoaderContext = {
      resourcePath,
      async: () => (error, code, map) => {
        if (error) reject(error instanceof Error ? error : new Error(String(error)));
        else resolve({ code, map });
      },
    };
    loader.call(context, source);
  });
}

const COMPILER_TIMEOUT = 30_000;

// the loader imports the real ESM compiler on first call: not a 5s job under pnpm test
describe('@verbaly/next loader', { timeout: COMPILER_TIMEOUT }, () => {
  it('rewrites tagged templates to compiled keys', async () => {
    const { code, map } = await run('const x = t`Hello`;', 'C:/app/src/page.tsx');
    expect(code).toMatch(/t\("[A-Za-z0-9_-]{8}"\)/);
    expect(map).toBeDefined();
  });

  it('passes through files without messages', async () => {
    const source = 'export const n = 1;';
    const { code } = await run(source, 'C:/app/src/util.ts');
    expect(code).toBe(source);
  });

  it('skips node_modules', async () => {
    const source = 'const x = t`Hello`;';
    const { code } = await run(source, 'C:/app/node_modules/pkg/index.js');
    expect(code).toBe(source);
  });

  it('hands an unparseable file back untouched instead of failing the build', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = 'const x = t`Hello';
    const { code } = await run(source, 'C:/app/src/broken.tsx');
    expect(code).toBe(source);
    expect(warn.mock.calls[0]![0]).toContain('broken.tsx: could not be parsed');
    warn.mockRestore();
  });
});
