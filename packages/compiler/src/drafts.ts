import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalogs } from './catalog';
import type { ResolvedConfig } from './config';

export const DRAFTS_FILE = '.verbaly-drafts.json';

export type Drafts = Record<string, string[]>;

function draftsPath(cfg: ResolvedConfig): string {
  return join(cfg.dir, DRAFTS_FILE);
}

export function loadDrafts(cfg: ResolvedConfig): Drafts {
  let content: string;
  try {
    content = readFileSync(draftsPath(cfg), 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(content.replace(/^\uFEFF/, '')) as Drafts;
  } catch (error) {
    throw new Error(`[verbaly] ${draftsPath(cfg)} is not valid JSON, fix or delete the file`, {
      cause: error,
    });
  }
}

function serializeDrafts(drafts: Drafts): string {
  const sorted: Drafts = {};
  for (const locale of Object.keys(drafts).sort()) {
    const keys = [...new Set(drafts[locale])].sort();
    if (keys.length) sorted[locale] = keys;
  }
  return JSON.stringify(sorted, null, 2) + '\n';
}

// content-compared like catalogs: an unchanged write must not churn the file
export function saveDrafts(cfg: ResolvedConfig, drafts: Drafts): void {
  const serialized = serializeDrafts(drafts);
  const path = draftsPath(cfg);
  try {
    if (readFileSync(path, 'utf8') === serialized) return;
  } catch {
    mkdirSync(cfg.dir, { recursive: true });
  }
  writeFileSync(path, serialized);
}

export function markDrafts(drafts: Drafts, locale: string, keys: string[]): void {
  if (!keys.length) return;
  drafts[locale] = [...new Set([...(drafts[locale] ?? []), ...keys])];
}

// clears specific keys, or the whole locale when keys is omitted (approve everything)
export function clearDrafts(drafts: Drafts, locale: string, keys?: string[]): void {
  if (!drafts[locale]) return;
  if (!keys) {
    delete drafts[locale];
    return;
  }
  const drop = new Set(keys);
  drafts[locale] = drafts[locale].filter((key) => !drop.has(key));
  if (!drafts[locale].length) delete drafts[locale];
}

// a draft only counts while its translation is still present: a pruned or re-emptied
// key is no longer a "reviewable" draft, it is simply missing again
export function effectiveDrafts(drafts: Drafts, catalogs: Catalogs): Drafts {
  const out: Drafts = {};
  for (const [locale, keys] of Object.entries(drafts)) {
    const catalog = catalogs[locale] ?? {};
    const live = keys.filter((key) => catalog[key]);
    if (live.length) out[locale] = live;
  }
  return out;
}
