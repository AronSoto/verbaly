import {
  counted,
  loadState,
  resolveProvider,
  syncProject,
  translateProject,
} from '@verbaly/compiler';
import type { ResolvedConfig, TranslateProvider } from '@verbaly/compiler';
import { badRequest, scrub } from './http';
import { advance, finish, start, type Job } from './jobs';

export interface ExtractResult {
  added: Record<string, string[]>;
  // only the source locale counts as new text: a target gains a blank for every gap it had
  found: number;
  // source texts the code wrote over, a hand edit in the catalog among them
  replaced: number;
  messages: number;
  // the lock could not be read or written: the catalogs were, its drafts and stamps were not
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
    messages: result.messages,
    ...(result.stateProblem && { stateProblem: result.stateProblem }),
  };
}

export interface Plan {
  pending: Record<string, string[]>;
  total: number;
}

// translate is the one command that spends money and minutes, so the panel always shows the bill.
export async function planTranslate(
  cfg: ResolvedConfig,
  locales?: string[],
  provider?: TranslateProvider,
): Promise<Plan> {
  // the same run with nothing sent: the bill counts what the run would ask for
  const result = await translateProject(cfg, {
    locales,
    dryRun: true,
    provider: provider ?? (await resolveProvider(cfg)),
  });
  const total = Object.values(result.pending).reduce((n, keys) => n + keys.length, 0);
  return { pending: result.pending, total };
}

export async function startTranslate(cfg: ResolvedConfig, locales?: string[]): Promise<Job> {
  // a machine translation that lost its draft flag passes as reviewed: read the state first
  loadState(cfg);
  // resolved here, so a missing key answers this request and not a job nobody is reading yet
  const provider = await resolveProvider(cfg);
  // the job carries its own denominator, so progress reads the same whether or not you asked first
  const plan = await planTranslate(cfg, locales, provider);
  const job = start('translate', plan.total);
  const id = job.id;

  // the run outlives this request on purpose: the client asks the job how it is going
  void (async () => {
    try {
      // the one run the CLI and the MCP server take: what a machine wrote stays a draft
      const result = await translateProject(cfg, {
        locales,
        provider,
        onProgress: (p) => advance(id, p.keys, p.locale, p.error && scrub(p.error, cfg.root)),
      });
      const count = (record: Record<string, string[]>): number =>
        Object.values(record).reduce((n, keys) => n + keys.length, 0);
      const written = count(result.written);
      // on a failure the panel shows only this line, so it says what landed and what did not
      const failed = result.failed[0];
      finish(id, failed ? 'failed' : 'done', {
        result,
        written,
        kept: count(result.kept),
        message: failed
          ? `${counted(written, 'message')} translated, but ${counted(result.failed.length, 'batch', 'batches')} did not answer (${scrub(failed.error, cfg.root)}): run it again for the rest`
          : undefined,
      });
    } catch (error) {
      finish(id, 'failed', { message: scrub(error, cfg.root) });
    }
  })();

  return job;
}
