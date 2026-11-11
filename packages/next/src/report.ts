import type { DevReporter, ResolvedConfig, SyncProjectResult } from '@verbaly/compiler';
import type { Compiler } from './codegen';

// one per project: next.config can be evaluated more than once, and the watcher outlives it
const reporters = new Map<string, DevReporter>();

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
  // what a write-back says is the compiler's, the same lines vite dev prints
  reporter.sync(cfg, result, (finding) => {
    // the code changed this text since the last run, which is how a text it owns is edited
    if (previous && previous.get(finding.key) !== finding.site.message) return undefined;
    return previous !== undefined;
  });
  return new Map([...result.registry.messages()].map(([key, msg]) => [key, msg.message]));
}

// test hook: each test starts from a server that said nothing
export function resetReported(): void {
  reporters.clear();
}
