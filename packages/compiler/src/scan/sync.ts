import { flatten } from 'verbaly';
import { emptyCatalog, own, type Catalog, type Catalogs } from '../catalog/catalog';
import type { ResolvedConfig } from '../config/config';
import { MessageRegistry } from './registry';

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
  const added = emptyCatalog<string[]>();
  const replaced: ReplacedText[] = [];
  const source = own(catalogs, cfg.sourceLocale) ?? (catalogs[cfg.sourceLocale] = emptyCatalog());

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
    const catalog = own(catalogs, locale) ?? (catalogs[locale] = emptyCatalog());
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
  return Object.assign(emptyCatalog<Catalog>(), catalogs, { [cfg.sourceLocale]: source });
}

// drops keys no longer referenced
export function pruneCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): Record<string, string[]> {
  const removed = emptyCatalog<string[]>();
  // a file the parser could not read still uses its keys, so pruning now deletes live translations
  if (registry.parseErrors().length > 0) return removed;
  const keep = new Set([...registry.messages().keys(), ...registry.usedKeys().keys()]);
  for (const locale of cfg.locales) {
    const catalog = own(catalogs, locale);
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
