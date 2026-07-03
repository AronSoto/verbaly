import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from './config';

export type Catalog = Record<string, string>;
export type Catalogs = Record<string, Catalog>;

export function catalogPath(cfg: ResolvedConfig, locale: string): string {
  return join(cfg.dir, `${locale}.json`);
}

export function readCatalog(cfg: ResolvedConfig, locale: string): Catalog {
  try {
    return JSON.parse(readFileSync(catalogPath(cfg, locale), 'utf8')) as Catalog;
  } catch {
    return {};
  }
}

export function loadCatalogs(cfg: ResolvedConfig): Catalogs {
  const catalogs: Catalogs = {};
  for (const locale of cfg.locales) catalogs[locale] = readCatalog(cfg, locale);
  return catalogs;
}

export function serializeCatalog(catalog: Catalog): string {
  const sorted: Catalog = {};
  for (const key of Object.keys(catalog).sort()) {
    const value = catalog[key];
    if (value !== undefined) sorted[key] = value;
  }
  return JSON.stringify(sorted, null, 2) + '\n';
}

export function writeCatalog(cfg: ResolvedConfig, locale: string, catalog: Catalog): string {
  const serialized = serializeCatalog(catalog);
  mkdirSync(cfg.dir, { recursive: true });
  writeFileSync(catalogPath(cfg, locale), serialized);
  return serialized;
}
