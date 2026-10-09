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
// the real core types: an unresolved import types every instance as any, which hid a broken d.ts
const core = join(here, '..', '..', 'core', 'src', 'index.ts').replaceAll('\\', '/');

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    module: 'esnext',
    target: 'es2022',
    moduleResolution: 'bundler',
    types: [],
    // the d.ts is checked like any file: skipLibCheck is what hid four errors in it
    skipLibCheck: false,
    paths: { verbaly: [core] },
  },
  include: ['*.ts'],
});

const CATALOG = { inbox_title: 'Hi', inbox_body: 'Body', greet: 'Hello {name}' };

// a string assertion proves the declaration is written; only a type checker proves it constrains
function typecheck(source: string, options: { dts?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'verbaly-keys-'));
  try {
    writeFileSync(join(dir, 'tsconfig.json'), TSCONFIG);
    if (options.dts !== false) {
      writeFileSync(join(dir, 'verbaly.d.ts'), generateDts(CATALOG, { locales: ['en', 'es'] }));
    }
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
    // every error, the d.ts's own included: filtering to app.ts is how TS2344 went unseen
    return run().trim();
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

describe('the generated types reach every t a project holds', () => {
  it(
    'has no errors of its own, the ones skipLibCheck hides',
    () => {
      expect(
        typecheck(`import { t } from 'virtual:verbaly';\nexport const a = t('inbox_title');\n`),
      ).toBe('');
    },
    TSC_TIMEOUT,
  );

  it(
    'checks keys and params on an instance from the generated module, as on its t',
    () => {
      const errors = typecheck(
        `import { createInstance, createRequestInstance, verbaly } from 'virtual:verbaly';\n` +
          `export async function page(): Promise<string> {\n` +
          `  const v = await createRequestInstance('es');\n` +
          `  // @ts-expect-error a key no catalog has\n` +
          `  v.t('ghost_key');\n` +
          `  // @ts-expect-error greet needs its name\n` +
          `  v.t('greet');\n` +
          `  // @ts-expect-error a key no catalog has, on the SPA instance\n` +
          `  verbaly.t('ghost_key');\n` +
          `  return v.t('greet', { name: 'Ana' }) + createInstance().t('inbox_body') + v.t\`tagged\`;\n` +
          `}\n`,
      );
      expect(errors).toBe('');
    },
    TSC_TIMEOUT,
  );

  it(
    'types what useT and getT return, and the locale, through Register',
    () => {
      const errors = typecheck(
        `import type { Locale, Translate, Verbaly } from 'verbaly';\n` +
          `declare const t: Translate;\n` +
          `declare function useT(): Verbaly['t'];\n` +
          `// @ts-expect-error a key no catalog has\n` +
          `t('ghost_key');\n` +
          `// @ts-expect-error a key no catalog has, through what an adapter returns\n` +
          `useT()('ghost_key');\n` +
          `export const ok: string = t('greet', { name: 'Ana' }) + useT()('inbox_title');\n` +
          `export const es: Locale = 'es';\n` +
          `// @ts-expect-error a locale the project does not have\n` +
          `export const fr: Locale = 'fr';\n`,
      );
      expect(errors).toBe('');
    },
    TSC_TIMEOUT,
  );

  it(
    'names the key a typo got wrong, on every TypeScript, and still asks for params',
    () => {
      const errors = typecheck(
        `import { t } from 'virtual:verbaly';\n` +
          `export const typo = t('inbox_titel');\n` +
          `export const bare = t('greet');\n` +
          `export const fine = t('greet', { name: 'Ana' }) + t\`tagged \${1}\` + t.id('x')\`y\`;\n`,
      );
      // two overloads let TypeScript blame the template form and never mention the key
      expect(errors).toContain(`'"inbox_titel"' is not assignable to parameter of type`);
      expect(errors).toContain('VerbalyKey');
      expect(errors).toMatch(/app\.ts\(3,[\d]+\): error TS2554/);
      expect(errors.split('\n').filter((line) => line.startsWith('app.ts'))).toHaveLength(2);
    },
    TSC_TIMEOUT,
  );

  it(
    'leaves every key open in a project with no generated types',
    () => {
      const errors = typecheck(
        `import type { Locale, Translate } from 'verbaly';\n` +
          `declare const t: Translate;\n` +
          `export const a: string = t('anything', { any: 1 }) + t('else');\n` +
          `export const l: Locale = 'any string';\n`,
        { dts: false },
      );
      expect(errors).toBe('');
    },
    TSC_TIMEOUT,
  );
});
