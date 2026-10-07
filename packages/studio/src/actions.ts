import {
  collectOrigins,
  counted,
  extractProject,
  loadCatalogs,
  loadState,
  mergeTranslations,
  recordTranslations,
  resolveProvider,
  shippedCatalogs,
  syncProject,
  translateCatalogs,
} from '@verbaly/compiler';
import type { ResolvedConfig, TranslationWrite } from '@verbaly/compiler';
import { badRequest } from './http';
import { advance, finish, start, type Job } from './jobs';

export interface ExtractResult {
  added: Record<string, string[]>;
  // only the source locale counts as new text: a target gains a blank for every gap it had
  found: number;
  // source texts the code wrote over, a hand edit in the catalog among them
  replaced: number;
  messages: number;
  // the sidecar could not be read or written: the catalogs were, its drafts and stamps were not
  stateProblem?: string;
}

// Local, fast and free, so it answers in the same request instead of becoming a job.
export async function runExtract(cfg: ResolvedConfig): Promise<ExtractResult> {
  if (!cfg.include.length) {
    throw badRequest('source scanning is off (include: []), so there is nothing to extract');
  }
  // the same path as the CLI: catalogs, types and the review state move together
  const result = await syncProject(cfg);
  return {
    added: result.added,
    found: result.added[cfg.sourceLocale]?.length ?? 0,
    replaced: result.replaced.length,
    messages: result.registry.messages().size,
    ...(result.stateProblem && { stateProblem: result.stateProblem }),
  };
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
  // a machine translation that lost its draft flag passes as reviewed: read the state first
  loadState(cfg);
  const provider = await resolveProvider(cfg);
  // the job carries its own denominator, so progress reads the same whether or not you asked first
  const plan = await planTranslate(cfg, locales);
  const job = start('translate', plan.total);
  const id = job.id;

  // the run outlives this request on purpose: the client asks the job how it is going
  void (async () => {
    try {
      const registry = await extractProject(cfg);
      // the provider reads the text that ships, which is the text its answer has to match
      const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
      const result = await translateCatalogs(cfg, catalogs, provider, {
        locales,
        batchSize: cfg.translate.batchSize,
        concurrency: cfg.translate.concurrency,
        retries: cfg.translate.retries,
        origins: await collectOrigins(cfg, registry),
        onProgress: (p) => advance(id, p.keys, p.locale, p.error),
      });
      // what a machine wrote stays a draft: the panel does not get to change that rule
      const writes: TranslationWrite[] = [];
      let written = 0;
      let kept = 0;
      for (const [locale, keys] of Object.entries(result.translated)) {
        const catalog = catalogs[locale] ?? {};
        const landed = mergeTranslations(cfg, locale, catalog, keys);
        writes.push({
          locale,
          draft: true,
          entries: landed.map((key) => ({ key, text: catalog[key]! })),
        });
        written += landed.length;
        kept += keys.length - landed.length;
      }
      recordTranslations(cfg, catalogs[cfg.sourceLocale] ?? {}, writes);
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
