import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { glob } from 'tinyglobby';
import { flatten } from 'verbaly';
import type { Analysis } from './analyze';
import { emptyCatalog, own, type Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import { MessageRegistry } from './registry';
import { analyzeFile } from './sfc';

// what a build's scan read, file by file, until its transform takes each one
const kept = new WeakMap<MessageRegistry, Map<string, { code: string; analysis: Analysis }>>();

// keepSource: a build that transforms next takes these analyses instead of parsing every file again
export async function extractProject(
  cfg: ResolvedConfig,
  options: { keepSource?: boolean } = {},
): Promise<MessageRegistry> {
  const files = await glob(cfg.include, {
    cwd: cfg.root,
    ignore: cfg.exclude,
    absolute: true,
  });
  const registry = new MessageRegistry();
  const read = options.keepSource ? new Map<string, { code: string; analysis: Analysis }>() : null;
  // tinyglobby crawls sibling folders in parallel, so its order changes from one run to the next
  for (const file of files.sort()) {
    const code = readFileSync(file, 'utf8');
    const analysis = analyzeFile(code, file);
    registry.update(file, analysis);
    read?.set(file.replaceAll('\\', '/'), { code, analysis });
  }
  if (read) kept.set(registry, read);
  return registry;
}

// the scan's analysis of a file, handed out once and only when the code is what the scan read
export function scannedAnalysis(
  scan: MessageRegistry,
  file: string,
  code: string,
): Analysis | undefined {
  const read = kept.get(scan);
  const key = file.replaceAll('\\', '/');
  const entry = read?.get(key);
  read?.delete(key);
  return entry?.code === code ? entry.analysis : undefined;
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
  // flatten returns a fresh catalog with no prototype: the code writes into it, never the caller's
  const source = flatten(catalogs[cfg.sourceLocale] ?? {});
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
