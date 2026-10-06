import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { glob } from 'tinyglobby';
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
  for (const file of files) {
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

export interface SyncResult {
  added: Record<string, string[]>;
  replaced: string[];
}

// fills source texts + '' placeholders; a text written in the code always wins over the catalog
export function syncCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): SyncResult {
  const added: Record<string, string[]> = {};
  const replaced: string[] = [];
  const source = (catalogs[cfg.sourceLocale] ??= emptyCatalog());

  for (const [key, msg] of registry.messages()) {
    const before = own(source, key);
    if (before !== msg.message) {
      if (before) replaced.push(key);
      source[key] = msg.message;
      (added[cfg.sourceLocale] ??= []).push(key);
    }
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
