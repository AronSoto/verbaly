import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flatten, type MessageTree } from 'verbaly';
import type { ResolvedConfig } from './config';

export type Catalog = Record<string, string>;
export type Catalogs = Record<string, Catalog>;

export function catalogPath(cfg: ResolvedConfig, locale: string): string {
  return join(cfg.dir, `${locale}.json`);
}

// the flat view is the shape t() sees, so every command reads a catalog the way the runtime does
export function readCatalog(cfg: ResolvedConfig, locale: string): Catalog {
  const tree = readTree(cfg, locale);
  const bad = badLeaf(tree);
  // the runtime skips this leaf with a warn; a build tool that skipped it would write the skip back
  if (bad) {
    throw new Error(
      `[verbaly] ${catalogPath(cfg, locale)} has a non-string value at "${bad}", ` +
        'catalog values are text (groups of text are fine): fix the value',
    );
  }
  return flatten(tree);
}

// dotted path of the first value that is neither text nor a group of text (an array is a bad leaf)
export function badLeaf(tree: MessageTree, prefix = ''): string | undefined {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return path;
    const bad = badLeaf(value, path);
    if (bad) return bad;
  }
  return undefined;
}

// corrupt catalog throws: read as empty, the next extract would wipe the translations
function readTree(cfg: ResolvedConfig, locale: string): MessageTree {
  let content: string;
  try {
    content = readFileSync(catalogPath(cfg, locale), 'utf8');
  } catch {
    return {};
  }
  const parsed = parseTree(content);
  if (parsed) return parsed;
  throw new Error(
    `[verbaly] ${catalogPath(cfg, locale)} is not valid JSON, fix or delete the file`,
  );
}

// a byte order mark is legal in the file and illegal to JSON.parse: drop it by code, never by regex
function parseTree(content: string): MessageTree | undefined {
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  try {
    return JSON.parse(body) as MessageTree;
  } catch {
    return undefined;
  }
}

export function loadCatalogs(cfg: ResolvedConfig): Catalogs {
  const catalogs: Catalogs = {};
  for (const locale of cfg.locales) catalogs[locale] = readCatalog(cfg, locale);
  return catalogs;
}

// the nesting is the author's: a file written as groups is handed back as groups
function isNested(tree: MessageTree): boolean {
  return Object.values(tree).some((value) => typeof value === 'object' && value !== null);
}

// dotted key back to its group; a path already taken by text stays flat so nothing is overwritten
function nest(catalog: Catalog): MessageTree {
  const tree: MessageTree = {};
  // sorted, so "hero" always lands before "hero.title" and a message is never replaced by its group
  for (const [key, message] of Object.entries(catalog).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const parts = key.split('.');
    const leaf = parts[parts.length - 1]!;
    let node: MessageTree | undefined = parts.length > 1 ? tree : undefined;
    for (let i = 0; node && i < parts.length - 1; i++) {
      const next = (node[parts[i]!] ??= {});
      node = typeof next === 'object' && next !== null ? (next as MessageTree) : undefined;
    }
    if (node && typeof node[leaf] !== 'object') node[leaf] = message;
    else tree[key] = message;
  }
  return tree;
}

function sortTree(tree: MessageTree): MessageTree {
  const sorted: MessageTree = {};
  for (const key of Object.keys(tree).sort()) {
    const value = tree[key];
    if (typeof value === 'string') sorted[key] = value;
    else if (value !== undefined) sorted[key] = sortTree(value as MessageTree);
  }
  return sorted;
}

export function serializeCatalog(catalog: Catalog, nested = false): string {
  return JSON.stringify(sortTree(nested ? nest(catalog) : catalog), null, 2) + '\n';
}

export function writeCatalog(cfg: ResolvedConfig, locale: string, catalog: Catalog): string {
  const path = catalogPath(cfg, locale);
  let existing: string | undefined;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    mkdirSync(cfg.dir, { recursive: true });
  }
  const serialized = serializeCatalog(catalog, wantsNesting(cfg, locale, existing));
  // identical writes are skipped: a rewrite retriggers whatever watches the catalog
  if (existing === serialized) return serialized;
  writeFileSync(path, serialized);
  return serialized;
}

// the file's own shape, and for a locale that does not exist yet, the source catalog's
function wantsNesting(cfg: ResolvedConfig, locale: string, existing: string | undefined): boolean {
  if (existing !== undefined) {
    const tree = parseTree(existing);
    return tree !== undefined && isNested(tree);
  }
  if (locale === cfg.sourceLocale) return false;
  return isNested(readTree(cfg, cfg.sourceLocale));
}
