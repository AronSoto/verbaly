import type { ResolvedConfig } from './config';
import { loadState, saveState, type Drafts } from './state';

export { effectiveDrafts, STATE_FILE } from './state';
export type { Drafts } from './state';

export function loadDrafts(cfg: ResolvedConfig): Drafts {
  return loadState(cfg).drafts;
}

// the drafts share their file with the fingerprints, so a save keeps whatever else it holds
export function saveDrafts(cfg: ResolvedConfig, drafts: Drafts): void {
  const state = loadState(cfg);
  saveState(cfg, { ...state, drafts });
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
