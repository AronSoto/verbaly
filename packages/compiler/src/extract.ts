import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { glob } from 'tinyglobby';
import { flatten } from 'verbaly';
import { emptyCatalog, own, type Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import { MessageRegistry } from './registry';
import { analyzeFile } from './sfc';

export async function extractProject(cfg: ResolvedConfig): Promise<MessageRegistry> {
  const files = await glob(cfg.include, {
    cwd: cfg.root,
    ignore: cfg.exclude,
    absolute: true,
  });
  const registry = new MessageRegistry();
  // tinyglobby crawls sibling folders in parallel, so its order changes from one run to the next
  for (const file of files.sort()) {
    registry.update(file, analyzeFile(readFileSync(file, 'utf8'), file));
  }
  return registry;
}

// root-relative with forward slashes so a translator reads the same path on any OS, one scan
export async function collectOrigins(
  cfg: ResolvedConfig,
  reuse?: MessageRegistry,
): Promise<Record<string, string[]>> {
  const registry = reuse ?? (await extractProject(cfg));
  const origins: Record<string, string[]> = Object.create(null);
  for (const [key, files] of registry.origins()) {
    origins[key] = files.map((file) => relative(cfg.root, file).replaceAll('\\', '/'));
  }
  return origins;
}

// a source text the code wrote over, and what the catalog said before
export interface ReplacedText {
  key: string;
  before: string;
}

export interface SyncResult {
  // keys new to each catalog; a source text the code rewrote is in replaced, not here
  added: Record<string, string[]>;
  replaced: ReplacedText[];
}

// fills source texts + '' placeholders; a text written in the code always wins over the catalog
export function syncCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): SyncResult {
  const added: Record<string, string[]> = {};
  const replaced: ReplacedText[] = [];
  const source = (catalogs[cfg.sourceLocale] ??= emptyCatalog());

  for (const [key, msg] of registry.messages()) {
    const before = own(source, key);
    if (before === msg.message) continue;
    source[key] = msg.message;
    if (before) replaced.push({ key, before });
    else (added[cfg.sourceLocale] ??= []).push(key);
  }

  const needed = Object.keys(source);
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    const catalog = (catalogs[locale] ??= emptyCatalog());
    for (const key of needed) {
      if (own(catalog, key) === undefined) {
        catalog[key] = '';
        (added[locale] ??= []).push(key);
      }
    }
  }
  return { added, replaced };
}

// the catalogs as a build ships them: the code's text wherever the code owns one, read-only
export function shippedCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
  // false: only keys the source catalog has, for the commands that run after extract
  options: { newKeys?: boolean } = {},
): Catalogs {
  const source = Object.assign(emptyCatalog(), flatten(catalogs[cfg.sourceLocale] ?? {}));
  for (const [key, msg] of registry.messages()) {
    if (options.newKeys !== false || own(source, key) !== undefined) source[key] = msg.message;
  }
  return { ...catalogs, [cfg.sourceLocale]: source };
}

// drops keys no longer referenced
export function pruneCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): Record<string, string[]> {
  const removed: Record<string, string[]> = {};
  // a file the parser could not read still uses its keys, so pruning now deletes live translations
  if (registry.parseErrors().length > 0) return removed;
  const keep = new Set([...registry.messages().keys(), ...registry.usedKeys().keys()]);
  for (const locale of cfg.locales) {
    const catalog = catalogs[locale];
    if (!catalog) continue;
    for (const key of Object.keys(catalog)) {
      if (!keep.has(key)) {
        delete catalog[key];
        (removed[locale] ??= []).push(key);
      }
    }
  }
  return removed;
}
