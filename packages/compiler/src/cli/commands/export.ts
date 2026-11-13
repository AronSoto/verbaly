import { loadCatalogs } from '../../catalog/catalog';
import type { ResolvedConfig } from '../../config/config';
import { exportCatalogs, isMobileFormat, type ExportFormat } from '../../exchange/exchange';
import { collectOrigins, extractProject } from '../../scan/extract';
import { shippedCatalogs } from '../../scan/sync';
import { counted } from '../../util/text';
import { csv, type CliValues } from '../args';

export async function exportCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const format = (values.format ?? 'xliff') as ExportFormat;
  if (!['xliff', 'csv', 'po', 'android-xml', 'ios-strings'].includes(format)) {
    console.error(
      `[verbaly] unknown format "${values.format}", use xliff, csv, po, android-xml or ios-strings`,
    );
    process.exitCode = 1;
    return;
  }
  if (values.missing && isMobileFormat(format)) {
    console.error(
      `[verbaly] --missing is for translator formats (xliff, csv): ${format} already skips untranslated keys so the app falls back to the source locale`,
    );
    process.exitCode = 1;
    return;
  }
  const registry = await extractProject(cfg);
  // a translator gets the text that ships, never a catalog the code has since moved past
  const shipped = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
  const result = exportCatalogs(cfg, shipped, {
    locales: csv(values.locales),
    format,
    out: values.out,
    missing: values.missing,
    // mobile formats are delivery-only: no translator reads where a text lives
    origins: isMobileFormat(format) ? undefined : await collectOrigins(cfg, registry),
  });
  if (result.files.length === 0) {
    console.log('[verbaly] no target locales to export (add locales to your config)');
    return;
  }
  const note = isMobileFormat(result.format) ? 'untranslated skipped' : 'untranslated';
  console.log(
    `[verbaly] exported ${counted(result.files.length, 'locale')} (${result.format}) → ${result.dir}`,
  );
  for (const file of result.files) {
    console.log(
      `  ${file.locale}: ${counted(file.total, 'message')} (${file.untranslated} ${note}) → ${file.path}`,
    );
  }
}
