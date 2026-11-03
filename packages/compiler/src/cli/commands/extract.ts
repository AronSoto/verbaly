import type { ResolvedConfig } from '../../config/config';
import { watchProject } from '../../emit/watch';
import { createDevReporter, formatFinding } from '../../gate/findings';
import { syncProject } from '../../project/project';
import { counted } from '../../util/text';
import type { CliValues } from '../args';

export async function extractCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const dryRun = values['dry-run'];
  if (values.watch && (dryRun || values.prune)) {
    console.error(
      '[verbaly] --watch runs alone: prune is a deliberate one-shot action and dry-run writes nothing',
    );
    process.exitCode = 1;
    return;
  }

  // a watch run says each warning once, and again only after it went away and came back
  const reporter = values.watch
    ? createDevReporter(cfg.root, (line) => console.warn(`  ${line}`))
    : undefined;

  async function runExtract(): Promise<void> {
    const result = await syncProject(cfg, { prune: values.prune, dryRun });
    if (result.pruneBlocked) {
      const unread = result.registry.parseErrors().length;
      console.warn(
        `  prune skipped: an unparsed file may read any key (${counted(unread, 'file')} below), so it waits until every file parses`,
      );
    }
    for (const [locale, keys] of Object.entries(result.pruned)) {
      console.log(
        dryRun
          ? `  ${locale}: would prune ${keys.length}: ${keys.join(', ')}`
          : `  ${locale}: -${keys.length} pruned`,
      );
    }
    // keys-first code writes none of the messages, so the code's count alone reads as 0
    const origin = result.inCode === result.messages ? '' : ` (${result.inCode} in code)`;
    console.log(
      `[verbaly] ${counted(result.messages, 'message')}${origin} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
    );
    for (const [locale, keys] of Object.entries(result.added)) {
      console.log(`  ${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length}`}`);
    }
    // news either way: an edit the code made or undid, or the lock appearing
    const warnings = result.findings.filter((finding) => {
      if (finding.kind !== 'replaced' && finding.kind !== 'lock') return true;
      console.log(`  ${formatFinding(finding, cfg.root)}`);
      return false;
    });
    if (reporter) reporter.report('extract', warnings);
    else for (const finding of warnings) console.warn(`  ${formatFinding(finding, cfg.root)}`);
    if (result.stateProblem) {
      console.warn(
        `  ${result.stateProblem}, so drafts and outdated translations were not updated`,
      );
    }
  }

  await runExtract();
  if (values.watch) {
    watchProject(cfg, runExtract);
    console.log('[verbaly] watching for source changes (ctrl+c to stop)');
  }
}
