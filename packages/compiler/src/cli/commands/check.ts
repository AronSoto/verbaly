import { loadCatalogs } from '../../catalog/catalog';
import { effectiveDrafts } from '../../catalog/state';
import { loadState, readState, type State } from '../../catalog/lock';
import type { ResolvedConfig } from '../../config/config';
import { check } from '../../gate/check';
import {
  checkNextSteps,
  formatCheckResult,
  formatCheckWarnings,
  githubCheckAnnotations,
} from '../../gate/report';
import { extractProject } from '../../scan/extract';
import { counted } from '../../util/text';
import type { CliValues } from '../args';
import { byLocale } from '../output';

export async function checkCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const reporter = values.reporter ?? 'text';
  if (reporter !== 'text' && reporter !== 'github') {
    console.error(`[verbaly] unknown reporter "${values.reporter}", use text or github`);
    process.exitCode = 1;
    return;
  }
  const registry = await extractProject(cfg);
  const catalogs = loadCatalogs(cfg);
  const state = checkState(cfg, values.drafts === true || values.outdated === true);
  const result = check(cfg, catalogs, registry, state.fingerprints);
  // opt-in: unreviewed machine translations and outdated ones block the merge too
  const unreviewed = values.drafts ? effectiveDrafts(state.drafts, catalogs) : {};
  const outdated = values.outdated ? result.outdated : [];
  const gated = { outdatedFails: values.outdated === true };
  // the annotations carry both severities, so they print whether the gate passes or not
  if (reporter === 'github') {
    for (const line of githubCheckAnnotations(result, registry, cfg, gated)) {
      console.error(line);
    }
  } else {
    const warnings = formatCheckWarnings(result, cfg.root, gated);
    if (warnings) console.warn(`[verbaly] warnings (the gate still passes)\n${warnings}`);
  }

  const awaiting = [
    ...Object.entries(unreviewed).map(
      ([locale, keys]) => `  [${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`,
    ),
    ...byLocale(outdated).map(
      ([locale, keys]) => `  [${locale}] ${keys.length} outdated: ${keys.join(', ')}`,
    ),
  ];
  if (result.ok && awaiting.length === 0) {
    console.log('[verbaly] all translations complete ✓');
    return;
  }
  if (!result.ok) {
    const brokenCount = result.broken.filter((entry) => entry.severity === 'error').length;
    const report =
      reporter === 'github'
        ? `[verbaly] check failed: ${result.missing.length} missing, ${result.unknown.length} unknown, ${brokenCount} broken, ${counted(result.collisions.length, 'collision')}`
        : `[verbaly] check failed\n${formatCheckResult(result, cfg.root)}`;
    console.error(`${report}\n${checkNextSteps(result)}`);
  }
  // printed whether or not the gate failed too: a flag that fails the run names what it found
  if (awaiting.length > 0) {
    for (const line of awaiting) console.error(line);
    console.error(
      '[verbaly] check failed: translations awaiting review (run verbaly review, then --approve what holds)',
    );
  }
  process.exitCode = 1;
}

// check reads the state for its warnings, and it only has to be readable when a flag gates on it
function checkState(cfg: ResolvedConfig, gating: boolean): State {
  if (gating) return loadState(cfg);
  const { state, problem } = readState(cfg);
  if (problem) console.warn(`[verbaly] ${problem}, so outdated translations are not reported`);
  return state;
}
