import { emptyCatalog, loadCatalogs, writeCatalog } from '../catalog/catalog';
import { recordTranslations } from '../catalog/state';
import { loadState, lockNews, stateFile, type LockEntry } from '../catalog/lock';
import { targetLocales, type ResolvedConfig } from '../config/config';
import {
  mergePlan,
  resolveProvider,
  translateCatalogs,
  type TranslateFailure,
  type TranslateProgress,
  type TranslateProvider,
} from '../exchange/translate';
import { collectOrigins, extractProject } from '../scan/extract';
import { shippedCatalogs } from '../scan/sync';

export interface TranslateProjectOptions {
  locales?: string[];
  // lists what would be sent: no provider call, nothing written
  dryRun?: boolean;
  model?: string;
  // one the caller resolved already, to fail on a missing key before the run starts
  provider?: TranslateProvider;
  onProgress?: (progress: TranslateProgress) => void;
}

export interface TranslateProjectResult {
  // a dry run only: what would be translated
  pending: Record<string, string[]>;
  // saved as drafts and stamped with the source text they were made for
  written: Record<string, string[]>;
  // written on disk by someone else while the provider worked, so left as they were
  kept: Record<string, string[]>;
  invalid: Record<string, string[]>;
  // batches the provider never answered, and languages whose save failed
  failed: TranslateFailure[];
  // this run brought verbaly.lock into being, and the file belongs in git
  lock?: LockEntry;
}

// the one translate run: the text that ships goes out, and what answers lands as a stamped draft
export async function translateProject(
  cfg: ResolvedConfig,
  options: TranslateProjectOptions = {},
): Promise<TranslateProjectResult> {
  // a name the project lacks is said first: before the state, the scan and a provider's key
  if (options.locales) targetLocales(cfg, options.locales);
  const dryRun = options.dryRun === true;
  // a machine translation that lost its draft flag passes as reviewed: read the state first
  if (!dryRun) loadState(cfg);
  const registry = await extractProject(cfg);
  // the provider reads the text that ships, which is the text its answer has to match
  const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
  const provider = options.provider ?? (await resolveProvider(cfg, options.model));
  const source = catalogs[cfg.sourceLocale] ?? {};
  const written: Record<string, string[]> = emptyCatalog();
  const kept: Record<string, string[]> = emptyCatalog();
  // where the state lived before this run's first save: a lock someone else made is not its news
  let before: { file: string | undefined } | undefined;

  // a language is saved when its last batch lands, so a run cut later keeps what it finished
  const save = (locale: string, keys: string[]): void => {
    const catalog = catalogs[locale] ?? {};
    try {
      // the file as it is now: what someone wrote while the provider worked is not overwritten
      const { current, landed } = mergePlan(cfg, locale, catalog, keys);
      if (landed.length > 0) {
        const entries = landed.map((key) => ({ key, text: catalog[key]! }));
        before ??= { file: stateFile(cfg) };
        // the mark before the text: cut between the two, a mark with no text is nothing to review
        recordTranslations(cfg, source, [{ locale, draft: true, entries }]);
        writeCatalog(cfg, locale, current);
        written[locale] = landed;
      }
      const left = keys.filter((key) => !landed.includes(key));
      if (left.length > 0) kept[locale] = left;
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      throw new Error(`could not be saved: ${why}`, { cause: error });
    }
  };

  const run = await translateCatalogs(cfg, catalogs, provider, {
    locales: options.locales,
    batchSize: cfg.translate.batchSize,
    concurrency: cfg.translate.concurrency,
    retries: cfg.translate.retries,
    dryRun,
    // a dry run never calls the provider, so it sends no origins either
    origins: dryRun ? undefined : await collectOrigins(cfg, registry),
    onProgress: dryRun ? undefined : options.onProgress,
    onLocale: dryRun ? undefined : save,
  });
  const result: TranslateProjectResult = {
    pending: run.pending,
    written: emptyCatalog(),
    kept: emptyCatalog(),
    invalid: run.invalid,
    failed: run.failed,
  };
  if (dryRun) return result;

  // languages finish in the order the provider answers: the report reads in the project's order
  for (const locale of targetLocales(cfg, options.locales)) {
    if (written[locale]) result.written[locale] = written[locale];
    if (kept[locale]) result.kept[locale] = kept[locale];
  }
  const lock = before && lockNews(cfg, before.file);
  if (lock) result.lock = lock;
  return result;
}
