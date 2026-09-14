import { toPanel } from './model';
import type { Panel, RawState } from './model';

// $state deep-proxies it, so a cell written back repaints its row; a plain object does not.
export function reactivePanel(raw: RawState): Panel {
  const panel = $state(toPanel(raw));
  return panel;
}

// A command rewrote the catalogs, so every row comes back rather than being patched key by key.
export function applyState(panel: Panel, raw: RawState): void {
  Object.assign(panel, toPanel(raw));
}
