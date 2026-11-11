import type { ResolvedConfig } from '../../config/config';
import { formatWrapResult, wrapProject } from '../../scan/wrap';
import { counted } from '../../util/text';
import type { CliValues } from '../args';

export async function wrapCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const write = values.write === true;
  const result = await wrapProject(cfg, { write });
  if (result.wrapped.length === 0 && result.skipped.length === 0) {
    console.log(`[verbaly] nothing to wrap (${counted(result.files, 'file')} scanned) ✓`);
    return;
  }
  const report = formatWrapResult(result, write);
  const note = write ? '' : ' (report only, use --write to apply)';
  console.log(`[verbaly] ${report.counts}${note}`);
  for (const line of report.lines) console.log(line);
  if (result.blocked.length > 0) {
    console.log('  next: add t there, run verbaly wrap --write again, then verbaly extract');
  } else if (write && report.files > 0) {
    console.log('  next: run verbaly extract');
  }
}
