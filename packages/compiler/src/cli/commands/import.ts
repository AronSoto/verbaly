import { loadCatalogs, writeCatalog } from '../../catalog/catalog';
import { recordTranslations, type TranslationWrite } from '../../catalog/state';
import { loadState, stateFile } from '../../catalog/lock';
import type { ResolvedConfig } from '../../config/config';
import { importCatalogs } from '../../exchange/exchange';
import { extractProject } from '../../scan/extract';
import { shippedCatalogs } from '../../scan/sync';
import { counted } from '../../util/text';
import type { CliValues } from '../args';
import { sayLockNews } from '../output';

export async function importCommand(
  cfg: ResolvedConfig,
  values: CliValues,
  positionals: string[],
): Promise<void> {
  const files = positionals.slice(1);
  if (files.length === 0) {
    console.error('[verbaly] import needs at least one file: verbaly import verbaly-export/es.xlf');
    process.exitCode = 1;
    return;
  }
  // the draft flags are written after the catalogs: an unreadable state writes neither
  if (!values['dry-run']) loadState(cfg);
  const registry = await extractProject(cfg);
  // checked against the text that ships, like check reads every translation
  const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
  const result = importCatalogs(cfg, catalogs, files, {
    locale: values.locale,
    overwrite: values.overwrite,
    dryRun: values['dry-run'],
  });
  for (const { file, from, to } of result.mapped) {
    console.log(`  ${file}: "${from}" read as ${to}`);
  }
  // a warning and exit 1, like a batch translate could not land: the file is skipped, not guessed
  for (const { file, locale, reason } of result.unmatched) {
    if (reason === 'undeclared') {
      console.warn(
        `  ${file}: "${locale}" is not one of this project's locales (${cfg.locales.join(', ')}), so nothing was imported from it`,
      );
      console.warn(
        `    fix: add ${locale} to locales in your verbaly config, or pass --locale with one of them`,
      );
    } else {
      console.warn(`  ${file}: "${locale}" is not a locale tag, so nothing was imported from it`);
      console.warn('    fix: pass --locale with the tag it stands for, like pt-BR');
    }
    process.exitCode = 1;
  }
  // a person's file clears the draft flag unless --draft, stamped with the source it carried
  const writes: TranslationWrite[] = [];
  for (const [locale, keys] of Object.entries(result.imported)) {
    if (!values['dry-run']) {
      const catalog = catalogs[locale] ?? {};
      writeCatalog(cfg, locale, catalog);
      const seen = result.sources[locale] ?? {};
      const entries = keys.map((key) => ({ key, text: catalog[key]!, source: seen[key] }));
      writes.push({ locale, entries, draft: values.draft === true });
    }
    const verb = values['dry-run'] ? 'would import' : 'imported';
    console.log(`  ${locale}: +${keys.length} ${verb}${values.draft ? ' (draft)' : ''}`);
  }
  const lockBefore = stateFile(cfg);
  if (writes.length > 0) recordTranslations(cfg, catalogs[cfg.sourceLocale] ?? {}, writes);
  sayLockNews(cfg, lockBefore);
  for (const [locale, keys] of Object.entries(result.skipped)) {
    console.log(
      `  ${locale}: ${keys.length} already translated, kept (use --overwrite to replace)`,
    );
  }
  for (const [locale, keys] of Object.entries(result.rejected)) {
    console.warn(
      `  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
    );
  }
  for (const [locale, keys] of Object.entries(result.unknown)) {
    console.warn(
      `  ${locale}: ${counted(keys.length, 'unknown key')} ignored (not in the source catalog): ${keys.join(', ')}`,
    );
  }
  if (Object.keys(result.imported).length === 0 && result.unmatched.length === 0) {
    console.log('[verbaly] nothing to import ✓');
  }
}
