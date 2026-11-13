import { loadCatalogs } from '../../catalog/catalog';
import { readState } from '../../catalog/lock';
import type { ResolvedConfig } from '../../config/config';
import { formatStatusResult, status } from '../../gate/status';
import { extractProject } from '../../scan/extract';
import type { CliValues } from '../args';

export async function statusCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const registry = await extractProject(cfg);
  const { state, problem } = readState(cfg);
  if (problem) {
    console.warn(`[verbaly] ${problem}, so drafts and outdated translations are not counted`);
  }
  const result = status(cfg, loadCatalogs(cfg), registry, state.drafts, state.fingerprints);
  console.log(values.json ? JSON.stringify(result) : formatStatusResult(result));
}
