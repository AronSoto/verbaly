import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findConfigFile } from './config';

export interface InitOptions {
  root?: string;
  dir?: string;
  sourceLocale?: string;
  locales?: string[];
}

export interface InitResult {
  created: string[];
  skipped: string[];
  bundler: 'vite' | 'webpack' | 'rollup' | 'rspack' | 'esbuild' | undefined;
  configFile: string;
  next: string[];
}

const BUNDLERS = ['vite', 'webpack', 'rollup', 'rspack', 'esbuild'] as const;

export function detectBundler(root: string): InitResult['bundler'] {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return BUNDLERS.find((name) => deps[name]);
  } catch {
    return undefined;
  }
}

function configSource(options: InitOptions, typescript: boolean): string {
  const fields = [`  sourceLocale: '${options.sourceLocale ?? 'en'}',`];
  if (options.locales?.length) {
    fields.push(`  locales: [${options.locales.map((l) => `'${l}'`).join(', ')}],`);
  }
  if (options.dir) fields.push(`  dir: '${options.dir}',`);
  const body = `export default {\n${fields.join('\n')}\n}`;
  if (typescript) {
    return `import type { VerbalyConfig } from '@verbaly/compiler';\n\n${body} satisfies VerbalyConfig;\n`;
  }
  return `/** @type {import('@verbaly/compiler').VerbalyConfig} */\n${body};\n`;
}

export function init(options: InitOptions = {}): InitResult {
  const root = options.root ?? process.cwd();
  const created: string[] = [];
  const skipped: string[] = [];

  const existing = findConfigFile(root);
  const typescript = existsSync(join(root, 'tsconfig.json'));
  const configFile = existing ?? (typescript ? 'verbaly.config.ts' : 'verbaly.config.mjs');
  if (existing) {
    skipped.push(existing);
  } else {
    writeFileSync(join(root, configFile), configSource(options, typescript));
    created.push(configFile);
  }

  const dir = join(root, options.dir ?? 'locales');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const locale of new Set([options.sourceLocale ?? 'en', ...(options.locales ?? [])])) {
    const file = join(dir, `${locale}.json`);
    const label = relative(root, file).replaceAll('\\', '/');
    if (existsSync(file)) {
      skipped.push(label);
    } else {
      writeFileSync(file, '{}\n');
      created.push(label);
    }
  }

  const bundler = detectBundler(root);
  const next: string[] = [];
  if (bundler === 'vite') {
    next.push(
      'install the plugin: pnpm add -D @verbaly/vite',
      'add verbaly() to the plugins in vite.config',
    );
  } else if (bundler) {
    next.push(
      'install the plugin: pnpm add -D @verbaly/unplugin',
      `add the verbaly ${bundler} plugin to your build config`,
    );
  } else {
    next.push('run "verbaly extract" after writing your first t`…` message');
  }

  return { created, skipped, bundler, configFile, next };
}
