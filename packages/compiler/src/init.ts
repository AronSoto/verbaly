import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findConfigFile, loadConfigFile } from './config';
import { detectHost, installCommand, type Host } from './host';
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
  if (existing) {
    skipped.push(existing);
  } else {
    writeFileSync(join(root, configFile), configSource(options, typescript));
    created.push(configFile);
  }

  // a config already answers where the catalogs go: guessing again scaffolds a second set
  const fromFile = existing ? await loadConfigFile(root) : {};
  const scaffold: InitOptions = {
    dir: options.dir ?? fromFile.dir,
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
  // the line its README teaches, in the project's own package manager
  const next = host
    ? [installCommand(root, host.install), host.wire]
    : ['run "verbaly extract" after writing your first t`…` message'];

  return { created, skipped, host: host?.name, configFile, next, renamed, refused };
}
