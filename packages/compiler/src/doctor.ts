import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Catalogs } from './catalog';
import { check } from './check';
import { generateDts } from './codegen';
import { findConfigFile, type ResolvedConfig } from './config';
import { extractProject } from './extract';
import { detectBundler } from './init';

export interface DoctorEntry {
  level: 'ok' | 'warn' | 'error';
  check: string;
  message: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean; // no error-level entries (warns allowed)
  entries: DoctorEntry[];
}

const PREVIEW = 5; // keys shown before "…"

export async function doctor(cfg: ResolvedConfig): Promise<DoctorResult> {
  const entries: DoctorEntry[] = [];
  const ok = (check: string, message: string) => entries.push({ level: 'ok', check, message });
  const warn = (check: string, message: string, fix: string) =>
    entries.push({ level: 'warn', check, message, fix });
  const error = (check: string, message: string, fix: string) =>
    entries.push({ level: 'error', check, message, fix });
  const rel = (path: string) => relative(cfg.root, path).replaceAll('\\', '/');

  const configFile = findConfigFile(cfg.root);
  if (configFile) ok('config', `${configFile} found`);
  else warn('config', 'no config file — running on defaults', 'run `npx verbaly init`');

  const catalogs: Catalogs = {};
  let catalogsHealthy = true;
  if (!existsSync(cfg.dir)) {
    catalogsHealthy = false;
    error(
      'catalogs',
      `catalogs directory ${rel(cfg.dir)}/ does not exist`,
      'run `npx verbaly init` to scaffold it',
    );
  } else {
    for (const locale of cfg.locales) {
      const file = join(cfg.dir, `${locale}.json`);
      if (!existsSync(file)) {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is missing`,
          'run `npx verbaly extract` to create it',
        );
        continue;
      }
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        const bad = Object.entries(parsed).find(([, value]) => typeof value !== 'string');
        if (bad) {
          catalogsHealthy = false;
          error(
            `locale ${locale}`,
            `${rel(file)} has a non-string value at "${bad[0]}"`,
            'catalogs are flat key → string JSON; fix the value',
          );
        } else {
          catalogs[locale] = parsed as Record<string, string>;
        }
      } catch {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is not valid JSON`,
          'repair the file (or delete it and run `npx verbaly extract`)',
        );
      }
    }
    if (catalogsHealthy) {
      ok(
        'catalogs',
        `${cfg.locales.length} locales (${cfg.locales.join(', ')}) in ${rel(cfg.dir)}/`,
      );
    }
  }

  const source = catalogs[cfg.sourceLocale];
  if (source && Object.keys(source).length === 0) {
    warn(
      'source',
      `source catalog ${cfg.sourceLocale}.json is empty`,
      'write your first t`…` message and run `npx verbaly extract`',
    );
  }

  const deps = readDeps(cfg.root);
  const bundler = detectBundler(cfg.root);
  const wired = deps['@verbaly/vite'] || deps['@verbaly/unplugin'];
  if (!bundler) {
    ok('plugin', 'no bundler detected — CLI flow (extract/check) applies');
  } else if (wired) {
    ok(
      'plugin',
      `${deps['@verbaly/vite'] ? '@verbaly/vite' : '@verbaly/unplugin'} installed for ${bundler}`,
    );
  } else if (bundler === 'vite') {
    warn(
      'plugin',
      'vite detected but @verbaly/vite is not installed',
      'pnpm add -D @verbaly/vite and add verbaly() to the plugins in vite.config',
    );
  } else {
    warn(
      'plugin',
      `${bundler} detected but @verbaly/unplugin is not installed`,
      `pnpm add -D @verbaly/unplugin and add the verbaly ${bundler} plugin to your build config`,
    );
  }

  if (source) {
    const dtsPath = join(cfg.root, 'verbaly.d.ts');
    if (!existsSync(dtsPath)) {
      warn('types', 'verbaly.d.ts has not been generated', 'run `npx verbaly extract`');
    } else if (readFileSync(dtsPath, 'utf8') !== generateDts(new Map(Object.entries(source)))) {
      warn('types', 'verbaly.d.ts is stale', 'run `npx verbaly extract`');
    } else {
      ok('types', 'verbaly.d.ts is up to date');
    }
  }

  const registry = await extractProject(cfg);
  if (source) {
    const extracted = registry.messages();
    const used = registry.usedKeys();
    const orphans = Object.keys(source).filter((key) => !extracted.has(key) && !used.has(key));
    if (orphans.length > 0) {
      warn(
        'orphans',
        `${orphans.length} catalog ${orphans.length === 1 ? 'key is' : 'keys are'} no longer referenced (${preview(orphans)})`,
        'run `npx verbaly extract --prune` to drop them',
      );
    } else {
      ok('orphans', 'no orphan keys');
    }
  }

  if (catalogsHealthy) {
    const result = check(cfg, catalogs, registry);
    if (result.unknown.length > 0) {
      error(
        'keys',
        `${result.unknown.length} unknown ${result.unknown.length === 1 ? 'key' : 'keys'} used in code (${preview(result.unknown.map((u) => u.key))})`,
        'fix the key or add it to the catalogs — `npx verbaly check` for details',
      );
    }
    if (result.missing.length > 0) {
      const locales = [...new Set(result.missing.map((m) => m.locale))];
      warn(
        'translations',
        `${result.missing.length} missing ${result.missing.length === 1 ? 'translation' : 'translations'} (${locales.join(', ')})`,
        'run `npx verbaly translate` or fill the catalogs — `npx verbaly check` for details',
      );
    }
    if (result.ok) ok('translations', 'all translations complete');
  }

  return { ok: entries.every((entry) => entry.level !== 'error'), entries };
}

function preview(keys: string[]): string {
  const head = keys.slice(0, PREVIEW).join(', ');
  return keys.length > PREVIEW ? `${head}, …` : head;
}

function readDeps(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}
