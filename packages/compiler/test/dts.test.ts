import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DTS_HEADER, generateDts, writeDts } from '../src/codegen';
import { resolveConfig } from '../src/config';
import { includeTypes, typesIncluded } from '../src/tsconfig';

function nextProject(tsconfig?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-dts-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '^16.0.0' } }));
  if (tsconfig !== undefined) writeFileSync(join(root, 'tsconfig.json'), tsconfig);
  return root;
}

function viteProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-dts-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { vite: '^8.0.0' } }));
  mkdirSync(join(root, 'src'));
  return root;
}

const NEXT_TSCONFIG = `{
  // what create-next-app writes, comments and a trailing comma included
  "compilerOptions": { "strict": true },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts",],
  "exclude": ["node_modules"]
}
`;

describe('generateDts', () => {
  it('sorts by code unit, so every machine writes the same file whatever its language', () => {
    const dts = generateDts({ b: 'B', aa: 'AA', _x: 'X', A: 'Upper' }, { locales: ['es', 'en'] });
    const order = ['"A"', '"_x"', '"aa"', '"b"'].map((key) => dts.indexOf(`${key}: never;`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // localeCompare puts "_x" first and "A" after "aa": the order of the machine's language
    expect(['b', 'aa', '_x', 'A'].sort((a, b) => a.localeCompare(b, 'en'))).not.toEqual([
      'A',
      '_x',
      'aa',
      'b',
    ]);
  });

  it('names the project locales, so getRequestLocale and Locale take only those', () => {
    const dts = generateDts({ hi: 'Hi' }, { locales: ['pt-BR', 'en', 'es'] });
    expect(dts).toContain('export type VerbalyLocale = "en" | "es" | "pt-BR";');
    expect(dts).toContain('export const sourceLocale: VerbalyLocale;');
    expect(dts.startsWith(DTS_HEADER)).toBe(true);
  });
});

describe('writeDts', () => {
  it('writes where the config resolves, and says when nothing changed', () => {
    const root = viteProject();
    const cfg = resolveConfig({ root });
    expect(writeDts(cfg, { hi: 'Hi' })).toEqual({
      file: join(root, 'src', 'verbaly.d.ts'),
      changed: true,
    });
    expect(writeDts(cfg, { hi: 'Hi' })).toEqual({
      file: join(root, 'src', 'verbaly.d.ts'),
      changed: false,
    });
  });

  it('removes the root verbaly.d.ts it wrote before, since two files declare one module', () => {
    const root = viteProject();
    writeFileSync(join(root, 'verbaly.d.ts'), generateDts({ old: 'Old' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeDts(resolveConfig({ root }), { hi: 'Hi' });
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
    expect(warn.mock.calls.flat().join('\n')).toContain('the types live in src/verbaly.d.ts now');
    warn.mockRestore();
  });

  it('keeps a root verbaly.d.ts a person wrote, which carries no header of ours', () => {
    const root = viteProject();
    writeFileSync(join(root, 'verbaly.d.ts'), 'declare const mine: string;\n');
    writeDts(resolveConfig({ root }), { hi: 'Hi' });
    expect(readFileSync(join(root, 'verbaly.d.ts'), 'utf8')).toBe('declare const mine: string;\n');
  });

  it('keeps the line endings of the file it replaces', () => {
    const root = viteProject();
    const cfg = resolveConfig({ root });
    const file = join(root, 'src', 'verbaly.d.ts');
    writeFileSync(file, generateDts({ hi: 'Hi' }, { locales: ['en'] }).replace(/\n/g, '\r\n'));
    // the same content checked out with CRLF is not a change
    expect(writeDts(cfg, { hi: 'Hi' })?.changed).toBe(false);
    writeDts(cfg, { hi: 'Hi', bye: 'Bye' });
    const written = readFileSync(file, 'utf8');
    expect(written).toContain('"bye": never;\r\n');
    expect(written.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('adds .verbaly/types.d.ts to the include of tsconfig, keeping its comments', () => {
    const root = nextProject(NEXT_TSCONFIG);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeDts(resolveConfig({ root }), { hi: 'Hi' });
    warn.mockRestore();
    expect(existsSync(join(root, '.verbaly', 'types.d.ts'))).toBe(true);
    // generated, never committed: the CLI leaves the same .gitignore withVerbaly does
    expect(readFileSync(join(root, '.verbaly', '.gitignore'), 'utf8')).toBe('*\n');
    const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('".verbaly/types.d.ts"');
    expect(tsconfig).toContain('// what create-next-app writes');
    expect(tsconfig).toContain('".next/types/**/*.ts"');
    // the second write finds it there and leaves the file alone
    writeDts(resolveConfig({ root }), { hi: 'Hi', bye: 'Bye' });
    expect(readFileSync(join(root, 'tsconfig.json'), 'utf8')).toBe(tsconfig);
  });

  it('never touches a tsconfig of a project whose types are not in a dot folder', () => {
    const root = viteProject();
    const tsconfig = '{ "include": ["src"] }\n';
    writeFileSync(join(root, 'tsconfig.json'), tsconfig);
    writeDts(resolveConfig({ root }), { hi: 'Hi' });
    expect(readFileSync(join(root, 'tsconfig.json'), 'utf8')).toBe(tsconfig);
  });
});

describe('the tsconfig line', () => {
  const entry = (root: string) => join(root, '.verbaly', 'types.d.ts');

  it('reads a glob the way TypeScript does: **/*.ts never walks into a dot folder', () => {
    expect(typesIncluded(nextProject('{ "include": ["**/*.ts"] }'), entry('x'))).toBe('missing');
    const named = nextProject('{ "include": ["**/*.ts", "./.verbaly/types.d.ts"] }');
    expect(typesIncluded(named, entry(named))).toBe('present');
    const folder = nextProject('{ "include": [".verbaly"] }');
    expect(typesIncluded(folder, entry(folder))).toBe('present');
    const glob = nextProject('{ "include": [".verbaly/**/*.ts"] }');
    expect(typesIncluded(glob, entry(glob))).toBe('present');
  });

  it('adds to files when the tsconfig lists files and no include', () => {
    const root = nextProject('{ "files": ["app.ts"] }');
    expect(includeTypes(root, entry(root))).toBe('added');
    const json = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
      files: string[];
      include?: string[];
    };
    expect(json.files).toEqual(['app.ts', '.verbaly/types.d.ts']);
    expect(json.include).toBeUndefined();
  });

  it('keeps the default include when the tsconfig had none', () => {
    const root = nextProject('{ "compilerOptions": {} }');
    expect(includeTypes(root, entry(root))).toBe('added');
    const json = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8')) as {
      include: string[];
    };
    expect(json.include).toEqual(['**/*', '.verbaly/types.d.ts']);
  });

  it('never edits a tsconfig it cannot read, and says nothing is there without one', () => {
    const broken = nextProject('{ "include": [ ');
    expect(includeTypes(broken, entry(broken))).toBe('unreadable');
    expect(readFileSync(join(broken, 'tsconfig.json'), 'utf8')).toBe('{ "include": [ ');
    const none = nextProject();
    expect(includeTypes(none, entry(none))).toBe('no-tsconfig');
  });
});
