import type { ResolvedConfig } from '../config/config';
import { loadState, saveState, type Drafts } from './lock';

export { effectiveDrafts } from './state';
export { clearDrafts, markDrafts, STATE_FILE } from './lock';
export type { Drafts } from './lock';

export function loadDrafts(cfg: ResolvedConfig): Drafts {
  return loadState(cfg).drafts;
}

// the drafts share their file with the fingerprints, so a save keeps whatever else it holds
export function saveDrafts(cfg: ResolvedConfig, drafts: Drafts): void {
  const state = loadState(cfg);
  saveState(cfg, { ...state, drafts });
}
