import type { Catalogs, ResolvedConfig } from '@verbaly/compiler';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Compiler = typeof import('@verbaly/compiler');

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

// dev pipeline shared by withVerbaly and the watcher: catalogs, dts, runtime modules
export function syncAndWrite(
  compiler: Compiler,
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: Awaited<ReturnType<Compiler['extractProject']>>,
  requestOptions: RequestOptions,
): void {
  const { added } = compiler.syncCatalogs(cfg, catalogs, registry);
  for (const locale of Object.keys(added)) {
    compiler.writeCatalog(cfg, locale, catalogs[locale] ?? {});
  }
  compiler.writeDts(cfg, catalogs[cfg.sourceLocale] ?? {});
  writeGeneratedModules(compiler, cfg, catalogs, requestOptions);
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

  const runtime = compiler.generateRuntimeModule(cfg, {
    localeImport: (locale) => `./locale/${locale}.js`,
    extraExports: `export const requestOptions = ${JSON.stringify(requestOptions)};\n`,
    icu: cfg.icu ?? compiler.needsIcu(catalogs),
  });
  changed = writeIfChanged(join(dir, 'index.js'), runtime) || changed;

  const expected = new Set(cfg.locales.map((locale) => `${locale}.js`));
  for (const locale of cfg.locales) {
    changed =
      writeIfChanged(
        join(localeDir, `${locale}.js`),
        compiler.generateLocaleModule(catalogs[locale] ?? {}),
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
