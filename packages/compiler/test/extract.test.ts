import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config/config';
import { READ_WINDOW, extractProject, readSources } from '../src/scan/extract';
import { stableKey } from '../src/util/key';

describe('extractProject', () => {
  it('globs source files and skips excluded paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-extract-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'src', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), 'const s = t`Hola ${name}`;\n');
    writeFileSync(join(root, 'src', 'other.tsx'), "t('home.title');\n");
    writeFileSync(join(root, 'src', 'node_modules', 'dep', 'i.ts'), 't`Ignorada`;\n');

    const registry = await extractProject(resolveConfig({ root, sourceLocale: 'es' }));
    const messages = registry.messages();
    expect(messages.has(stableKey('Hola {name}'))).toBe(true);
    expect(messages.has(stableKey('Ignorada'))).toBe(false);
    expect(registry.usedKeys().has('home.title')).toBe(true);
  });
});

const made: string[] = [];
afterAll(() => {
  for (const root of made) rmSync(root, { recursive: true, force: true });
});

// more than two windows of files, each one a line long
function sources(): string[] {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-reads-'));
  made.push(root);
  const files: string[] = [];
  for (let i = 0; i < READ_WINDOW * 2 + 2; i++) {
    const file = join(root, `b${String(i).padStart(3, '0')}.ts`);
    writeFileSync(file, `export const n = ${i};\n`);
    files.push(file);
  }
  return files.sort();
}

// counts the async reads and how many were open at once; the read of `late` lands after the rest
function watchAsyncReads(late?: string) {
  const original = fs.promises.readFile;
  const seen = { calls: 0, open: 0, most: 0 };
  const counted = async (path: fs.PathLike, encoding: BufferEncoding) => {
    seen.calls++;
    seen.open++;
    seen.most = Math.max(seen.most, seen.open);
    try {
      if (path === late) await new Promise((done) => setTimeout(done, 50));
      return await original(path, encoding);
    } finally {
      seen.open--;
    }
  };
  const spy = vi.spyOn(fs.promises, 'readFile').mockImplementation(counted as typeof original);
  syncBuiltinESMExports();
  return {
    seen,
    restore() {
      spy.mockRestore();
      syncBuiltinESMExports();
    },
  };
}

describe('readSources', () => {
  it('hands every file on in the order it was given, on every system', async () => {
    const files = sources();
    const reads = watchAsyncReads(files[0]);
    const platforms = ['win32', 'linux', 'darwin'] as const;
    const handed: Record<(typeof platforms)[number], Array<[string, string]>> = {
      win32: [],
      linux: [],
      darwin: [],
    };
    try {
      for (const platform of platforms) {
        await readSources(files, (file, code) => handed[platform].push([file, code]), platform);
      }
    } finally {
      reads.restore();
    }
    expect(handed.linux.map(([file]) => file)).toEqual(files);
    expect(handed.win32).toEqual(handed.linux);
    expect(handed.darwin).toEqual(handed.linux);
  });

  it('overlaps the reads on Windows, never more than the window at once', async () => {
    const files = sources();
    const reads = watchAsyncReads();
    try {
      await readSources(files, () => {}, 'win32');
      expect(reads.seen.calls).toBe(files.length);
      expect(reads.seen.most).toBe(READ_WINDOW);
    } finally {
      reads.restore();
    }
  });

  it('reads one file at a time, synchronously, away from Windows', async () => {
    const files = sources();
    const reads = watchAsyncReads();
    try {
      for (const platform of ['linux', 'darwin'] as const) {
        await readSources(files, () => {}, platform);
      }
      expect(reads.seen.calls).toBe(0);
    } finally {
      reads.restore();
    }
  });
});
