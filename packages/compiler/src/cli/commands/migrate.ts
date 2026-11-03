import { migrateCatalogs } from '../../catalog/migrate';
import { STATE_FILE, stateFile } from '../../catalog/state';
import type { ResolvedConfig } from '../../config/config';
import { counted } from '../../util/text';
import type { CliValues } from '../args';
import { sayLockNews } from '../output';

export async function migrateCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const lockBefore = stateFile(cfg);
  const result = migrateCatalogs(cfg, { write: values.write, plurals: values.plurals });
  const from = result.detected.length ? result.detected.join(', ') : 'no known i18n library';
  const changes = result.braces.length + result.plurals.length;
  // said every time: a run that converts nothing must not read as one that skipped a language
  const before = result.remembered.length
    ? `, ${counted(result.remembered.length, 'language')} converted before`
    : '';
  if (changes === 0 && result.skipped.length === 0) {
    console.log(`[verbaly] catalogs need nothing (${from}${before}) ✓`);
    return;
  }
  const verb = values.write ? 'ported' : 'would port';
  const note = values.write ? '' : ' (report only, use --write to apply)';
  console.log(`[verbaly] ${verb} ${counted(changes, 'message')} from ${from}${before}${note}`);
  for (const entry of result.braces) {
    console.log(`  ${entry.locale} ${entry.key}  ${entry.before} → ${entry.after}`);
  }
  for (const entry of result.plurals) {
    console.log(`  ${entry.locale} ${entry.key}  ${entry.from.join(' + ')} → ${entry.after}`);
  }
  if (!values.plurals && changes > 0) {
    console.log('  --plurals also merges _one/_other into one message with variants');
  }
  if (result.skipped.length > 0) {
    console.log('  needs a human:');
    for (const entry of result.skipped) {
      console.log(`  ${entry.locale} ${entry.key}  ${entry.reason}`);
    }
  }
  if (values.write && result.braces.length > 0) {
    console.log(
      `  ${STATE_FILE} remembers the converted languages, so a later run never reads them as i18next again`,
    );
  }
  sayLockNews(cfg, lockBefore);
  if (values.write) console.log('  next: run verbaly check');
}
