import { readFileSync } from 'node:fs';
import { loadCatalogs, own, writeCatalog, type Catalogs } from './catalog';
import { writeDts } from './codegen';
import type { ResolvedConfig } from './config';
import { extractProject, pruneCatalogs, syncCatalogs, type ReplacedText } from './extract';
import { scanFindings, type Finding } from './findings';
import type { MessageRegistry } from './registry';
import { analyzeFile } from './sfc';
import { updateState, type State } from './state';

// The one way the code reaches the catalogs: scan, prune, sync, write, keep the state in step
export interface SyncProjectOptions {
  prune?: boolean;
  dryRun?: boolean;
  registry?: MessageRegistry;
  catalogs?: Catalogs;
  confirm?: boolean;
  write?: 'all' | 'changed';
}

export interface SyncProjectResult {
  registry: MessageRegistry;
  catalogs: Catalogs;
  added: Record<string, string[]>;
  replaced: ReplacedText[];
  pruned: Record<string, string[]>;
  pruneBlocked: boolean;
  findings: Finding[];
  written: Record<string, string>;
  state?: State;
  stateProblem?: string;
}

// the one way the code reaches the catalogs: scan, prune, sync, write, keep the state in step
export async function syncProject(
  cfg: ResolvedConfig,
  options: SyncProjectOptions = {},
): Promise<SyncProjectResult> {
  const registry = options.registry ?? (await extractProject(cfg));
  const catalogs = options.catalogs ?? loadCatalogs(cfg);
  if (options.confirm) confirmFromDisk(cfg, catalogs, registry);
  const pruneBlocked = options.prune === true && registry.parseErrors().length > 0;
  const pruned = options.prune ? pruneCatalogs(cfg, catalogs, registry) : {};
  const { added, replaced } = syncCatalogs(cfg, catalogs, registry);
  const result: SyncProjectResult = {
    registry,
    catalogs,
    added,
    replaced,
    pruned,
    pruneBlocked,
    findings: scanFindings(cfg, registry, replaced),
    written: {},
  };
  if (options.dryRun) return result;

  const changed = new Set([...Object.keys(added), ...Object.keys(pruned)]);
  if (replaced.length > 0) changed.add(cfg.sourceLocale);
  for (const locale of cfg.locales) {
    if (options.write === 'changed' && !changed.has(locale)) continue;
    result.written[locale] = writeCatalog(cfg, locale, catalogs[locale] ?? {});
  }
  writeDts(cfg, catalogs[cfg.sourceLocale] ?? {});
  try {
    // a pruned key takes its draft along, and an edited source text marks its translations
    result.state = updateState(cfg, catalogs);
  } catch (error) {
    result.stateProblem = (error as Error).message.replace(/^\[verbaly\] /, '');
  }
  return result;
}

// a file can change on disk unseen by a registry built over time: a checkout, another terminal
function confirmFromDisk(cfg: ResolvedConfig, catalogs: Catalogs, registry: MessageRegistry): void {
  const source = catalogs[cfg.sourceLocale] ?? {};
  const stale = new Set<string>();
  for (const [key, msg] of registry.messages()) {
    if (own(source, key) !== msg.message) stale.add(msg.file);
  }
  for (const file of stale) {
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      registry.remove(file);
      continue;
    }
    registry.update(file, analyzeFile(code, file));
  }
}
