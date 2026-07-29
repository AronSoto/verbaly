import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from './config';

export type Catalog = Record<string, string>;
export type Catalogs = Record<string, Catalog>;

export function catalogPath(cfg: ResolvedConfig, locale: string): string {
  return join(cfg.dir, `${locale}.json`);
}

// corrupt catalog throws: read as empty, the next extract would wipe the translations
export function readCatalog(cfg: ResolvedConfig, locale: string): Catalog {
  let content: string;
  try {
    content = readFileSync(catalogPath(cfg, locale), 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(content.replace(/^\uFEFF/, '')) as Catalog;
  } catch (error) {
    throw new Error(
      `[verbaly] ${catalogPath(cfg, locale)} is not valid JSON, fix or delete the file`,
      { cause: error },
    );
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
  const path = catalogPath(cfg, locale);
  // identical writes are skipped: a rewrite retriggers whatever watches the catalog
  try {
    if (readFileSync(path, 'utf8') === serialized) return serialized;
  } catch {
    mkdirSync(cfg.dir, { recursive: true });
  }
  writeFileSync(path, serialized);
  return serialized;
}
