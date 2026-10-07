import type { Catalogs, ResolvedConfig } from '@verbaly/compiler';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportDev, type CodeTexts } from './report';

export type Compiler = typeof import('@verbaly/compiler');
export type Registry = Awaited<ReturnType<Compiler['extractProject']>>;

export interface RequestOptions {
  cookie?: string | false;
  fallback?: string;
}

export const GENERATED_DIR = '.verbaly';

export function generatedDir(root: string): string {
  return join(root, GENERATED_DIR);
}

// content compare: identical rewrites must not retrigger the bundler
function writeIfChanged(file: string, content: string): boolean {
  try {
    if (readFileSync(file, 'utf8') === content) return false;
  } catch {
    // new file
  }
  writeFileSync(file, content);
  return true;
}

// dev pipeline shared by withVerbaly and the watcher: the compiler's sync, then the runtime modules
export async function syncAndWrite(
  compiler: Compiler,
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: Registry,
  requestOptions: RequestOptions,
  previous?: CodeTexts,
): Promise<CodeTexts> {
  // 'changed': a catalog nothing happened to keeps the formatting its author gave it
  const result = await compiler.syncProject(cfg, { registry, catalogs, write: 'changed' });
  writeGeneratedModules(compiler, cfg, result.catalogs, requestOptions);
  return reportDev(compiler, cfg, result, previous);
}

// real-file replacement for virtual:verbaly: Turbopack has no virtual modules
export function writeGeneratedModules(
  compiler: Compiler,
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  requestOptions: RequestOptions = {},
): boolean {
  const dir = generatedDir(cfg.root);
  const localeDir = join(dir, 'locale');
  mkdirSync(localeDir, { recursive: true });

  let changed = writeIfChanged(join(dir, '.gitignore'), '*\n');

  // these files are the client module here, so bundle.exclude has to be applied on this path too
  const client = compiler.clientCatalogs(cfg, catalogs);
  const runtime = compiler.generateRuntimeModule(cfg, {
    localeImport: (locale) => `./locale/${locale}.js`,
    extraExports: `export const requestOptions = ${JSON.stringify(requestOptions)};\n`,
    icu: cfg.icu ?? compiler.needsIcu(client),
    relative: cfg.relative ?? compiler.needsRelative(client),
    inlineCatalog: cfg.render.inlineCatalog === true,
  });
  changed = writeIfChanged(join(dir, 'index.js'), runtime) || changed;

  const expected = new Set(cfg.locales.map((locale) => `${locale}.js`));
  for (const locale of cfg.locales) {
    changed =
      writeIfChanged(
        join(localeDir, `${locale}.js`),
        compiler.generateLocaleModule(client[locale] ?? {}),
      ) || changed;
  }
  for (const file of readdirSync(localeDir)) {
    if (!expected.has(file)) {
      rmSync(join(localeDir, file));
      changed = true;
    }
  }
  return changed;
}
