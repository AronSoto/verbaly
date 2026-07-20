import { describe, expect, it } from 'vitest';
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

describe('@verbaly/next loader', () => {
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

  it('reports a transform error through the async callback', async () => {
    // unterminated template in a transform target: Babel throws, loader forwards it
    await expect(run('const x = t`Hello', 'C:/app/src/broken.tsx')).rejects.toThrow();
  });
});
