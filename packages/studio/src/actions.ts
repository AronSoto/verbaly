import {
  collectOrigins,
  counted,
  extractProject,
  loadCatalogs,
  mergeTranslations,
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
  // the types come from the source catalog; writeDts skips them when the project set dts: false
  writeDts(cfg, catalogs[cfg.sourceLocale] ?? {});
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
      // what a machine wrote stays a draft: the panel does not get to change that rule
      const drafts = loadDrafts(cfg);
      let written = 0;
      let kept = 0;
      for (const [locale, keys] of Object.entries(result.translated)) {
        const landed = mergeTranslations(cfg, locale, catalogs[locale] ?? {}, keys);
        markDrafts(drafts, locale, landed);
        written += landed.length;
        kept += keys.length - landed.length;
      }
      saveDrafts(cfg, drafts);
      // on a failure the panel shows only this line, so it says what landed and what did not
      const failed = result.failed[0];
      finish(id, failed ? 'failed' : 'done', {
        result,
        written,
        kept,
        message: failed
          ? `${counted(written, 'message')} translated, but ${counted(result.failed.length, 'batch', 'batches')} did not answer (${failed.error}): run it again for the rest`
          : undefined,
      });
    } catch (error) {
      finish(id, 'failed', { message: error instanceof Error ? error.message : String(error) });
    }
  })();

  return job;
}
