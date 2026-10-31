import * as compiler from '@verbaly/compiler';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Routing } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { generatedDir, writeGeneratedModules as write } from '../src/codegen';

const writeGeneratedModules = write.bind(null, compiler);

function makeConfig(locales = ['en', 'es']) {
  return compiler.resolveConfig({
    root: mkdtempSync(join(tmpdir(), 'verbaly-next-')),
    sourceLocale: 'en',
    locales,
  });
}

const COMPILER_TIMEOUT = 30_000;

describe('writeGeneratedModules', { timeout: COMPILER_TIMEOUT }, () => {
  it('writes the runtime module with relative locale imports', () => {
    const cfg = makeConfig();
    writeGeneratedModules(cfg, { en: { a: 'A' }, es: { a: 'Á' } });
    const dir = generatedDir(cfg.root);

    const runtime = readFileSync(join(dir, 'index.js'), 'utf8');
    expect(runtime).toContain("import source from './locale/en.js'");
    expect(runtime).toContain('"es": () => import(\'./locale/es.js\')');
    expect(runtime).not.toContain('virtual:verbaly');
    expect(runtime).toContain('export async function loadMessages(locale)');

    expect(readFileSync(join(dir, 'locale', 'en.js'), 'utf8')).toBe('export default {"a":"A"};\n');
    expect(readFileSync(join(dir, 'locale', 'es.js'), 'utf8')).toBe('export default {"a":"Á"};\n');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('honors bundle.exclude: these files are the client module, there is no vite plugin here', () => {
    const cfg = compiler.resolveConfig({
      root: mkdtempSync(join(tmpdir(), 'verbaly-next-')),
      sourceLocale: 'en',
      locales: ['en', 'es'],
      bundle: { exclude: ['notes'] },
    });
    writeGeneratedModules(cfg, {
      en: { 'hero.a': 'A', 'notes.v1': 'Long' },
      es: { 'hero.a': 'Á', 'notes.v1': 'Largo' },
    });
    const dir = generatedDir(cfg.root);
    expect(readFileSync(join(dir, 'locale', 'en.js'), 'utf8')).toBe(
      'export default {"hero.a":"A"};\n',
    );
    expect(readFileSync(join(dir, 'locale', 'es.js'), 'utf8')).toBe(
      'export default {"hero.a":"Á"};\n',
    );
  });

  it('embeds the request options', () => {
    const cfg = makeConfig();
    writeGeneratedModules(cfg, {}, { cookie: 'my-locale', fallback: 'es' });
    const runtime = readFileSync(join(generatedDir(cfg.root), 'index.js'), 'utf8');
    expect(runtime).toContain(
      'export const requestOptions = {"cookie":"my-locale","fallback":"es"};',
    );
  });

  it('is idempotent: identical content is not rewritten', () => {
    const cfg = makeConfig();
    expect(writeGeneratedModules(cfg, { en: { a: 'A' } })).toBe(true);
    const file = join(generatedDir(cfg.root), 'index.js');
    const before = statSync(file).mtimeMs;
    expect(writeGeneratedModules(cfg, { en: { a: 'A' } })).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('removes locale modules that left the config', () => {
    const cfg = makeConfig();
    writeGeneratedModules(cfg, { en: {}, es: {} });
    const stale = join(generatedDir(cfg.root), 'locale', 'fr.js');
    writeFileSync(stale, 'export default {};\n');
    writeGeneratedModules(cfg, { en: {}, es: {} });
    expect(existsSync(stale)).toBe(false);
  });
});

// a project with its own next and an app tree, so the server module has something to read
function nextProject(options: { next?: string; tree: string[]; routing?: Routing }) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-next-root-'));
  if (options.next) {
    mkdirSync(join(root, 'node_modules', 'next'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', 'next', 'package.json'),
      JSON.stringify({ name: 'next', version: options.next }),
    );
  }
  for (const file of options.tree) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), 'export default function Layout() {}\n');
  }
  const cfg = compiler.resolveConfig({
    root,
    sourceLocale: 'en',
    locales: ['en', 'es'],
    routing: options.routing ?? 'prefix-all',
  });
  writeGeneratedModules(cfg, { en: {}, es: {} });
  return readFileSync(join(generatedDir(root), 'server.js'), 'utf8');
}

describe('the server module, next/root-params', { timeout: COMPILER_TIMEOUT }, () => {
  it('reads the segment of the root layout from Next 16.3 on', () => {
    const server = nextProject({ next: '16.3.0', tree: ['app/[lang]/layout.tsx'] });
    expect(server).toContain("import { lang as segment } from 'next/root-params';");
    expect(server).toContain('export const rootLocale = segment;');
  });

  it('finds it under route groups and in src/app, the same name in every root layout', () => {
    const server = nextProject({
      next: '16.4.3',
      tree: ['src/app/(site)/[locale]/layout.tsx', 'src/app/(shop)/[locale]/layout.js'],
    });
    expect(server).toContain("import { locale as segment } from 'next/root-params';");
  });

  it('reads nothing on Next 16.2, which ships the module behind a flag', () => {
    const server = nextProject({ next: '16.2.9', tree: ['app/[lang]/layout.tsx'] });
    expect(server).toBe(
      '// generated by @verbaly/next: no root segment to read, setRequestLocale declares it\nexport const rootLocale = undefined;\n',
    );
  });

  it('reads nothing on a 16.3.0 canary, which came before the default', () => {
    const server = nextProject({ next: '16.3.0-canary.12', tree: ['app/[lang]/layout.tsx'] });
    expect(server).toContain('export const rootLocale = undefined;');
  });

  it('reads nothing when the root layout sits above the segment', () => {
    const server = nextProject({ next: '16.4.3', tree: ['app/layout.tsx', 'app/[lang]/page.tsx'] });
    expect(server).toContain('export const rootLocale = undefined;');
  });

  it('reads nothing when two root layouts name the segment differently', () => {
    const server = nextProject({
      next: '16.4.3',
      tree: ['app/(a)/[lang]/layout.tsx', 'app/(b)/[locale]/layout.tsx'],
    });
    expect(server).toContain('export const rootLocale = undefined;');
  });

  it('reads nothing under no-prefix, where the url carries no locale', () => {
    const server = nextProject({
      next: '16.4.3',
      tree: ['app/[lang]/layout.tsx'],
      routing: 'no-prefix',
    });
    expect(server).toContain('export const rootLocale = undefined;');
  });
});
