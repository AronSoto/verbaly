import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateDts } from '../src/codegen';

// this file runs the real compiler, so it pays for a type checker and not for a unit
const TSC_TIMEOUT = 60_000;

const here = dirname(fileURLToPath(import.meta.url));
const tsc = join(here, '..', '..', '..', 'node_modules', '.bin', 'tsc');

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    module: 'esnext',
    target: 'es2022',
    moduleResolution: 'bundler',
    types: [],
  },
  include: ['*.ts'],
});

// a string assertion proves the declaration is written; only a type checker proves it constrains
function typecheck(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'verbaly-keys-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), TSCONFIG);
    writeFileSync(join(dir, 'verbaly.d.ts'), generateDts({ inbox_title: 'Hi', inbox_body: 'Body' }));
    writeFileSync(join(dir, 'app.ts'), source);
    // the path holds a space, and shell: true would split an unquoted one into two arguments
    const run = (): string => {
      try {
        // run from inside the fixture so tsc reports app.ts and not an absolute temp path
        return execFileSync(`"${tsc}"`, ['--noEmit', '-p', '.'], {
          cwd: dir,
          encoding: 'utf8',
          stdio: 'pipe',
          shell: true,
        });
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string };
        // a checker that never ran would report no errors, which reads exactly like a pass
        if (e.stdout === undefined) throw error;
        return `${e.stdout}${e.stderr ?? ''}`;
      }
    };
    // the fixture never installs verbaly itself, so the d.ts imports cannot resolve here
    return run()
      .split(/\r?\n/)
      .filter((line) => line.startsWith('app.ts'))
      .join('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('defineKeys constrains what a key module may declare', () => {
  it(
    'accepts keys the catalog has and keeps them literal, so t() still takes them',
    () => {
      const errors = typecheck(
        `import { defineKeys, t } from 'virtual:verbaly';\n` +
          `export const Text = defineKeys({ title: 'inbox_title', body: 'inbox_body' });\n` +
          `export const a = t(Text.title);\n`,
      );
      expect(errors).toBe('');
    },
    TSC_TIMEOUT,
  );

  it(
    'rejects a key no catalog has, where it is declared and not where it is used',
    () => {
      const errors = typecheck(
        `import { defineKeys } from 'virtual:verbaly';\n` +
          `export const Text = defineKeys({ title: 'inbox_title', body: 'ghost_key' });\n`,
      );
      expect(errors).toContain('is not assignable to type');
      expect(errors).toContain('ghost_key');
      // line 2 is the declaration: the whole point is that it fails there, not at the call site
      expect(errors).toMatch(/^app\.ts\(2,/);
    },
    TSC_TIMEOUT,
  );

  it(
    'reaches a nested group, because one entry can hold a whole dialog',
    () => {
      const errors = typecheck(
        `import { defineKeys } from 'virtual:verbaly';\n` +
          `export const Text = defineKeys({ dialog: { title: 'inbox_title', ok: 'ghost_key' } });\n`,
      );
      expect(errors).toContain('ghost_key');
    },
    TSC_TIMEOUT,
  );
});
