import {
  collectOrigins,
  extractProject,
  loadCatalogs,
  resolveProvider,
  syncCatalogs,
  translateCatalogs,
  writeCatalog,
  writeDts,
  markDrafts,
  loadDrafts,
  saveDrafts,
} from '@verbaly/compiler';
import type { ResolvedConfig } from '@verbaly/compiler';
import { badRequest } from './http';
import { advance, finish, start, type Job } from './jobs';

export interface ExtractResult {
  added: Record<string, string[]>;
  // only the source locale counts as new text: a target gains a blank for every gap it had
  found: number;
  messages: number;
}

// Local, fast and free, so it answers in the same request instead of becoming a job.
export async function runExtract(cfg: ResolvedConfig): Promise<ExtractResult> {
  if (!cfg.include.length) {
    throw badRequest('source scanning is off (include: []), so there is nothing to extract');
  }
  const registry = await extractProject(cfg);
  const catalogs = loadCatalogs(cfg);
  const result = syncCatalogs(cfg, catalogs, registry);
  for (const locale of cfg.locales) writeCatalog(cfg, locale, catalogs[locale] ?? {});
  // the types come from the source catalog, and cfg.dts false means the project opted out
  if (cfg.dts !== false) writeDts(cfg, catalogs[cfg.sourceLocale] ?? {}, cfg.dts);
  const found = result.added[cfg.sourceLocale]?.length ?? 0;
  return { added: result.added, found, messages: registry.messages().size };
}

export interface Plan {
  pending: Record<string, string[]>;
  total: number;
}

// translate is the one command that spends money and minutes, so the panel always shows the bill.
export async function planTranslate(cfg: ResolvedConfig, locales?: string[]): Promise<Plan> {
  const provider = await resolveProvider(cfg);
  const catalogs = loadCatalogs(cfg);
  const result = await translateCatalogs(cfg, catalogs, provider, { locales, dryRun: true });
  const total = Object.values(result.pending).reduce((n, keys) => n + keys.length, 0);
  return { pending: result.pending, total };
}

export async function startTranslate(cfg: ResolvedConfig, locales?: string[]): Promise<Job> {
  const provider = await resolveProvider(cfg);
  // the job carries its own denominator, so progress reads the same whether or not you asked first
  const plan = await planTranslate(cfg, locales);
  const job = start('translate', plan.total);
  const id = job.id;

  // the run outlives this request on purpose: the client asks the job how it is going
  void (async () => {
    try {
      const catalogs = loadCatalogs(cfg);
      const result = await translateCatalogs(cfg, catalogs, provider, {
        locales,
        batchSize: cfg.translate.batchSize,
        concurrency: cfg.translate.concurrency,
        retries: cfg.translate.retries,
        origins: await collectOrigins(cfg),
        onProgress: (p) => advance(id, p.keys, p.locale, p.error),
      });
      for (const [locale, keys] of Object.entries(result.translated)) {
        if (keys.length) writeCatalog(cfg, locale, catalogs[locale] ?? {});
      }
      // what a machine wrote stays a draft: the panel does not get to change that rule
      const drafts = loadDrafts(cfg);
      for (const [locale, keys] of Object.entries(result.translated)) {
        markDrafts(drafts, locale, keys);
      }
      saveDrafts(cfg, drafts);
      finish(id, result.failed.length ? 'failed' : 'done', {
        result,
        message: result.failed.length ? `${result.failed.length} batches did not answer` : undefined,
      });
    } catch (error) {
      finish(id, 'failed', { message: error instanceof Error ? error.message : String(error) });
    }
  })();

  return job;
}
