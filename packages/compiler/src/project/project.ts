import { readFileSync } from 'node:fs';
import { emptyCatalog, loadCatalogs, own, writeCatalog, type Catalogs } from '../catalog/catalog';
import { writeDts } from '../emit/codegen';
import type { ResolvedConfig } from '../config/config';
import { extractProject } from '../scan/extract';
import { pruneCatalogs, syncCatalogs, type ReplacedText } from '../scan/sync';
import { scanFindings, type Finding } from '../gate/findings';
import type { MessageRegistry } from '../scan/registry';
import { analyzeFile } from '../scan/sfc';
import { updateState } from '../catalog/state';
import { lockNews, stateFile, type State } from '../catalog/lock';

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
  messages: number;
  inCode: number;
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
    messages: Object.keys(catalogs[cfg.sourceLocale] ?? emptyCatalog()).length,
    inCode: registry.messages().size,
    added,
    replaced,
    pruned,
    pruneBlocked,
    findings: scanFindings(cfg, registry, replaced),
    written: emptyCatalog(),
  };
  if (options.dryRun) return result;

  const changed = new Set([...Object.keys(added), ...Object.keys(pruned)]);
  if (replaced.length > 0) changed.add(cfg.sourceLocale);
  for (const locale of cfg.locales) {
    if (options.write === 'changed' && !changed.has(locale)) continue;
    result.written[locale] = writeCatalog(cfg, locale, catalogs[locale] ?? emptyCatalog());
  }
  writeDts(cfg, catalogs[cfg.sourceLocale] ?? emptyCatalog());
  const before = stateFile(cfg);
  try {
    // a pruned key takes its draft along, and an edited source text marks its translations
    result.state = updateState(cfg, catalogs);
  } catch (error) {
    result.stateProblem = (error as Error).message.replace(/^\[verbaly\] /, '');
  }
  const news = lockNews(cfg, before);
  if (news) result.findings.push({ kind: 'lock', ...news });
  return result;
}

// a file can change on disk unseen by a registry built over time: a checkout, another terminal
function confirmFromDisk(cfg: ResolvedConfig, catalogs: Catalogs, registry: MessageRegistry): void {
  const source = catalogs[cfg.sourceLocale] ?? emptyCatalog();
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
