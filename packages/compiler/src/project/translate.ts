import { emptyCatalog, loadCatalogs } from '../catalog/catalog';
import {
  loadState,
  lockNews,
  recordTranslations,
  stateFile,
  type LockEntry,
  type TranslationWrite,
} from '../catalog/state';
import type { ResolvedConfig } from '../config/config';
import {
  mergeTranslations,
  resolveProvider,
  translateCatalogs,
  type TranslateFailure,
  type TranslateProgress,
  type TranslateProvider,
} from '../exchange/translate';
import { collectOrigins, extractProject, shippedCatalogs } from '../scan/extract';

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
  failed: TranslateFailure[];
  // this run brought verbaly.lock into being, and the file belongs in git
  lock?: LockEntry;
}

// the one translate run: the text that ships goes out, and what answers lands as a stamped draft
export async function translateProject(
  cfg: ResolvedConfig,
  options: TranslateProjectOptions = {},
): Promise<TranslateProjectResult> {
  const dryRun = options.dryRun === true;
  // a machine translation that lost its draft flag passes as reviewed: read the state first
  if (!dryRun) loadState(cfg);
  const registry = await extractProject(cfg);
  // the provider reads the text that ships, which is the text its answer has to match
  const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
  const provider = options.provider ?? (await resolveProvider(cfg, options.model));
  const run = await translateCatalogs(cfg, catalogs, provider, {
    locales: options.locales,
    batchSize: cfg.translate.batchSize,
    concurrency: cfg.translate.concurrency,
    retries: cfg.translate.retries,
    dryRun,
    // a dry run never calls the provider, so it sends no origins either
    origins: dryRun ? undefined : await collectOrigins(cfg, registry),
    onProgress: dryRun ? undefined : options.onProgress,
  });
  const result: TranslateProjectResult = {
    pending: run.pending,
    written: emptyCatalog(),
    kept: emptyCatalog(),
    invalid: run.invalid,
    failed: run.failed,
  };
  if (dryRun) return result;

  // machine output is a draft until a human reviews it, stamped with the text it was made for
  const writes: TranslationWrite[] = [];
  for (const [locale, keys] of Object.entries(run.translated)) {
    const catalog = catalogs[locale] ?? {};
    // the file as it is now: what someone wrote while the provider worked is not overwritten
    const landed = mergeTranslations(cfg, locale, catalog, keys);
    const left = keys.filter((key) => !landed.includes(key));
    if (left.length > 0) result.kept[locale] = left;
    if (landed.length === 0) continue;
    result.written[locale] = landed;
    writes.push({
      locale,
      draft: true,
      entries: landed.map((key) => ({ key, text: catalog[key]! })),
    });
  }
  const before = stateFile(cfg);
  if (writes.length > 0) recordTranslations(cfg, catalogs[cfg.sourceLocale] ?? {}, writes);
  const lock = lockNews(cfg, before);
  if (lock) result.lock = lock;
  return result;
}
