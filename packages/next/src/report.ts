import type { DevReporter, Finding, ResolvedConfig, SyncProjectResult } from '@verbaly/compiler';
import type { Compiler } from './codegen';

// one per project: next.config can be evaluated more than once, and the watcher outlives it
const reporters = new Map<string, DevReporter>();
const brokenState = new Set<string>();

// the code texts of the last run tell an edit in the code from an edit in the catalog
export type CodeTexts = Map<string, string>;

export function reportDev(
  compiler: Compiler,
  cfg: ResolvedConfig,
  result: SyncProjectResult,
  previous: CodeTexts | undefined,
): CodeTexts {
  let reporter = reporters.get(cfg.root);
  if (!reporter) {
    reporter = compiler.createDevReporter(cfg.root);
    reporters.set(cfg.root, reporter);
  }
  const replaced: Finding[] = [];
  const code: Finding[] = [];
  for (const finding of result.findings) {
    if (finding.kind === 'collision' || finding.kind === 'renamed') code.push(finding);
    if (finding.kind !== 'replaced') continue;
    // the code changed this text since the last run, which is how a text it owns is edited
    if (previous && previous.get(finding.key) !== finding.site.message) continue;
    replaced.push({ ...finding, edited: previous !== undefined });
  }
  reporter.report('replaced', replaced);
  reporter.report('code', code);
  const outdated = result.state
    ? compiler.outdatedTranslations(cfg, result.catalogs, result.state.fingerprints)
    : [];
  reporter.report(
    'outdated',
    outdated.map((entry): Finding => ({ kind: 'outdated', ...entry })),
  );

  // a broken sidecar must not stop next dev: said once, and again if it breaks after a fix
  if (result.stateProblem && !brokenState.has(cfg.root)) {
    console.warn(`[verbaly] ${result.stateProblem}, so drafts are not tracked`);
  }
  if (result.stateProblem) brokenState.add(cfg.root);
  else brokenState.delete(cfg.root);

  return new Map([...result.registry.messages()].map(([key, msg]) => [key, msg.message]));
}

// test hook: each test starts from a server that said nothing
export function resetReported(): void {
  reporters.clear();
  brokenState.clear();
}
