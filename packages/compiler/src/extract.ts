import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { glob } from 'tinyglobby';
import type { Catalogs } from './catalog';
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

// root-relative, forward slashes: paths a translator can read on any OS
export async function collectOrigins(cfg: ResolvedConfig): Promise<Record<string, string[]>> {
  const registry = await extractProject(cfg);
  const origins: Record<string, string[]> = {};
  for (const [key, files] of registry.origins()) {
    origins[key] = files.map((file) => relative(cfg.root, file).replaceAll('\\', '/'));
  }
  return origins;
}

export interface SyncResult {
  added: Record<string, string[]>;
}

// fills source texts + '' placeholders
export function syncCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): SyncResult {
  const added: Record<string, string[]> = {};
  const source = (catalogs[cfg.sourceLocale] ??= {});

  for (const [key, msg] of registry.messages()) {
    if (source[key] !== msg.message) {
      source[key] = msg.message;
      (added[cfg.sourceLocale] ??= []).push(key);
    }
  }

  const needed = Object.keys(source);
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    const catalog = (catalogs[locale] ??= {});
    for (const key of needed) {
      if (catalog[key] === undefined) {
        catalog[key] = '';
        (added[locale] ??= []).push(key);
      }
    }
  }
  return { added };
}

// drops keys no longer referenced
export function pruneCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): Record<string, string[]> {
  const keep = new Set([...registry.messages().keys(), ...registry.usedKeys().keys()]);
  const removed: Record<string, string[]> = {};
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
