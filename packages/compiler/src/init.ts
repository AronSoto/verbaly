import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findConfigFile, loadConfigFile } from './config';
import { detectHost, installCommand, readDependencies, type Host } from './host';
import { detectLibraries } from './migrate';
import { isLocaleTag, suggestTag } from './tag';

export type { Host };

export interface InitOptions {
  root?: string;
  dir?: string;
  sourceLocale?: string;
  locales?: string[];
}

export interface InitResult {
  created: string[];
  skipped: string[];
  host: Host | undefined;
  configFile: string;
  next: string[];
  renamed: { from: string; to: string }[];
  refused: string[];
  // catalogs the project already had, which the new config points at instead of a fresh folder
  found?: string;
}

// where i18n libraries keep a <locale>.json per language: a project that moves keeps its texts
const CATALOG_DIRS = [
  'locales',
  'src/locales',
  'src/i18n/locales',
  'src/i18n',
  'i18n',
  'lang',
  'src/lang',
  'translations',
  'src/translations',
  'messages',
];

function existingCatalogs(root: string): string | undefined {
  return CATALOG_DIRS.find((dir) => {
    try {
      return readdirSync(join(root, dir)).some(
        (file) => file.endsWith('.json') && isLocaleTag(file.slice(0, -5)),
      );
    } catch {
      return false;
    }
  });
}

// a package manager links a bin for a direct dependency only, and ours is usually transitive
export function cliReachable(root: string): boolean {
  const bin = join(root, 'node_modules', '.bin');
  return existsSync(join(bin, 'verbaly')) || existsSync(join(bin, 'verbaly.CMD'));
}

export const CLI_INSTALL_FIX =
  'add `@verbaly/compiler` to your dev dependencies, then `npx verbaly` resolves';

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

export async function init(input: InitOptions = {}): Promise<InitResult> {
  const root = input.root ?? process.cwd();
  const created: string[] = [];
  const skipped: string[] = [];
  const renamed: InitResult['renamed'] = [];
  const refused: string[] = [];

  // only what was typed is corrected: a locale in a config file is the author's, doctor says so
  const typed = input.locales?.flatMap((locale) => {
    if (isLocaleTag(locale)) return [locale];
    const near = suggestTag(locale);
    if (near) renamed.push({ from: locale, to: near });
    else refused.push(locale);
    return near ? [near] : [];
  });
  // pt_BR,pt-BR is one locale once written right, and the config must not list it twice
  const locales = typed && [...new Set(typed)];
  let sourceLocale = input.sourceLocale;
  if (sourceLocale !== undefined && !isLocaleTag(sourceLocale)) {
    const near = suggestTag(sourceLocale);
    if (!near) {
      throw new Error(
        `[verbaly] "${sourceLocale}" is not a locale tag: pass --source with one like en or pt-BR`,
      );
    }
    renamed.push({ from: sourceLocale, to: near });
    sourceLocale = near;
  }
  const options: InitOptions = { ...input, locales, sourceLocale };

  const existing = findConfigFile(root);
  const typescript = existsSync(join(root, 'tsconfig.json'));
  const configFile = existing ?? (typescript ? 'verbaly.config.ts' : 'verbaly.config.mjs');
  // only a config written now looks around: one already there, or a --dir, said where they go
  const found = existing || options.dir ? undefined : existingCatalogs(root);
  if (existing) {
    skipped.push(existing);
  } else {
    // the default needs no line, so a found locales/ leaves the config as short as ever
    const dir = found === 'locales' ? undefined : found;
    writeFileSync(
      join(root, configFile),
      configSource({ ...options, dir: options.dir ?? dir }, typescript),
    );
    created.push(configFile);
  }

  // a config already answers where the catalogs go: guessing again scaffolds a second set
  const fromFile = existing ? await loadConfigFile(root) : {};
  const scaffold: InitOptions = {
    dir: options.dir ?? fromFile.dir ?? found,
    sourceLocale: options.sourceLocale ?? fromFile.sourceLocale,
    locales: options.locales ?? fromFile.locales,
  };

  const dir = join(root, scaffold.dir ?? 'locales');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const locale of new Set([scaffold.sourceLocale ?? 'en', ...(scaffold.locales ?? [])])) {
    const file = join(dir, `${locale}.json`);
    const label = relative(root, file).replaceAll('\\', '/');
    if (existsSync(file)) {
      skipped.push(label);
    } else {
      writeFileSync(file, '{}\n');
      created.push(label);
    }
  }

  const host = detectHost(root);
  const deps = readDependencies(root);
  // the line its README teaches, in the project's own package manager, for what is not there yet
  const missing = host?.install.filter((pkg) => !deps[pkg]) ?? [];
  const next = host
    ? [...(missing.length ? [installCommand(root, missing)] : []), host.wire]
    : ['run "verbaly extract" after writing your first t`…` message'];
  const others = detectLibraries(root);
  if (found && others.length) {
    next.push(
      `port the ${others.join(' and ')} catalogs: npx verbaly migrate reports, --write applies`,
    );
  }

  return { created, skipped, host: host?.name, configFile, next, renamed, refused, found };
}
