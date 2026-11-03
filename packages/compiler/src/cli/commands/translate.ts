import { loadCatalogs } from '../../catalog/catalog';
import {
  loadState,
  recordTranslations,
  stateFile,
  type TranslationWrite,
} from '../../catalog/state';
import type { ResolvedConfig } from '../../config/config';
import {
  formatTranslateFailures,
  mergeTranslations,
  resolveProvider,
  translateCatalogs,
  type TranslateProgress,
} from '../../exchange/translate';
import { collectOrigins, extractProject, shippedCatalogs } from '../../scan/extract';
import { counted } from '../../util/text';
import { csv, type CliValues } from '../args';
import { sayLockNews } from '../output';

export async function translateCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  // a machine translation that lost its draft flag passes as reviewed: read the state first
  if (!values['dry-run']) loadState(cfg);
  const registry = await extractProject(cfg);
  // the provider reads the text that ships, which is the text its answer has to match
  const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
  const provider = await resolveProvider(cfg, values.model);
  const result = await translateCatalogs(cfg, catalogs, provider, {
    locales: csv(values.locales),
    batchSize: cfg.translate.batchSize,
    concurrency: cfg.translate.concurrency,
    retries: cfg.translate.retries,
    dryRun: values['dry-run'],
    // dry-run never calls the provider, so it sends no origins either
    origins: values['dry-run'] ? undefined : await collectOrigins(cfg, registry),
    onProgress: values['dry-run'] ? undefined : reportProgress,
  });

  if (values['dry-run']) {
    const entries = Object.entries(result.pending);
    if (entries.length === 0) {
      console.log('[verbaly] nothing to translate ✓');
      return;
    }
    for (const [locale, keys] of entries) {
      console.log(`  ${locale}: ${keys.length} missing: ${keys.join(', ')}`);
    }
    return;
  }

  // machine output is a draft until a human reviews it, stamped with the text it was made for
  const source = catalogs[cfg.sourceLocale] ?? {};
  const writes: TranslationWrite[] = [];
  for (const [locale, keys] of Object.entries(result.translated)) {
    const catalog = catalogs[locale] ?? {};
    const written = mergeTranslations(cfg, locale, catalog, keys);
    writes.push({
      locale,
      draft: true,
      entries: written.map((key) => ({ key, text: catalog[key]! })),
    });
    console.log(`  ${locale}: +${written.length} translated (draft)`);
    const kept = keys.length - written.length;
    if (kept > 0) {
      console.log(`  ${locale}: ${counted(kept, 'message')} kept as written while this ran`);
    }
  }
  const lockBefore = stateFile(cfg);
  if (writes.length > 0) recordTranslations(cfg, source, writes);
  sayLockNews(cfg, lockBefore);
  for (const [locale, keys] of Object.entries(result.invalid)) {
    console.warn(
      `  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
    );
  }
  for (const line of formatTranslateFailures(result.failed)) console.error(line);
  if (result.failed.length > 0) process.exitCode = 1;
  if (
    Object.keys(result.translated).length === 0 &&
    Object.keys(result.invalid).length === 0 &&
    result.failed.length === 0
  ) {
    console.log('[verbaly] nothing to translate ✓');
  }
}

// a translate run is minutes of network: say what landed as it lands, never only at the end
function reportProgress(progress: TranslateProgress): void {
  const head = `  ${progress.locale} ${progress.batch}/${progress.batches}`;
  if (progress.error) console.warn(`${head}: failed (${progress.error}), continuing`);
  else console.log(`${head}: ${counted(progress.keys, 'message')}`);
}
