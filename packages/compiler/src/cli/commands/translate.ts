import type { ResolvedConfig } from '../../config/config';
import { formatFinding } from '../../gate/findings';
import { formatTranslateFailures, type TranslateProgress } from '../../exchange/translate';
import { translateProject } from '../../project/translate';
import { counted } from '../../util/text';
import { csv, type CliValues } from '../args';

export async function translateCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const dryRun = values['dry-run'];
  const result = await translateProject(cfg, {
    locales: csv(values.locales),
    dryRun,
    model: values.model,
    onProgress: reportProgress,
  });

  if (dryRun) {
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

  for (const [locale, keys] of Object.entries(result.written)) {
    console.log(`  ${locale}: +${keys.length} translated (draft)`);
  }
  for (const [locale, keys] of Object.entries(result.kept)) {
    console.log(`  ${locale}: ${counted(keys.length, 'message')} kept as written while this ran`);
  }
  // a write that brought the lock into being is said once, where it happened
  if (result.lock) console.log(`  ${formatFinding({ kind: 'lock', ...result.lock }, cfg.root)}`);
  for (const [locale, keys] of Object.entries(result.invalid)) {
    console.warn(
      `  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
    );
  }
  for (const line of formatTranslateFailures(result.failed)) console.error(line);
  if (result.failed.length > 0) process.exitCode = 1;
  const quiet = [result.written, result.kept, result.invalid].every(
    (record) => Object.keys(record).length === 0,
  );
  if (quiet && result.failed.length === 0) console.log('[verbaly] nothing to translate ✓');
}

// a translate run is minutes of network: say what landed as it lands, never only at the end
function reportProgress(progress: TranslateProgress): void {
  const head = `  ${progress.locale} ${progress.batch}/${progress.batches}`;
  if (progress.error) console.warn(`${head}: failed (${progress.error}), continuing`);
  else console.log(`${head}: ${counted(progress.keys, 'message')}`);
}
