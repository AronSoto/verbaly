import type { ResolvedConfig } from './config';
import { loadState, saveState, type Drafts } from './state';

export { clearDrafts, effectiveDrafts, markDrafts, STATE_FILE } from './state';
export type { Drafts } from './state';

export function loadDrafts(cfg: ResolvedConfig): Drafts {
  return loadState(cfg).drafts;
}

// the drafts share their file with the fingerprints, so a save keeps whatever else it holds
export function saveDrafts(cfg: ResolvedConfig, drafts: Drafts): void {
  const state = loadState(cfg);
  saveState(cfg, { ...state, drafts });
}
