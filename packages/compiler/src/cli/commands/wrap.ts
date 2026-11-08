import type { ResolvedConfig } from '../../config/config';
import { wrapProject } from '../../scan/wrap';
import { counted } from '../../util/text';
import type { CliValues } from '../args';

export async function wrapCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const result = await wrapProject(cfg, { write: values.write });
  if (result.wrapped.length === 0 && result.skipped.length === 0) {
    console.log(`[verbaly] nothing to wrap (${counted(result.files, 'file')} scanned) ✓`);
    return;
  }
  const blocked = new Set(result.blocked.map((entry) => entry.file));
  const done = result.changed.filter((file) => !blocked.has(file));
  const texts = result.wrapped.filter((entry) => !blocked.has(entry.file));
  const verb = values.write ? 'wrapped' : 'would wrap';
  const note = values.write ? '' : ' (report only, use --write to apply)';
  let counts = `${counted(texts.length, 'text')} in ${counted(done.length, 'file')}`;
  // a report that promised texts --write then refused read as a bug: the wait is said up front
  const waiting = result.wrapped.length - texts.length;
  if (!values.write && waiting > 0) {
    counts += `, and ${counted(waiting, 'text')} in ${counted(blocked.size, 'file')} once t is in scope`;
  }
  console.log(`[verbaly] ${verb} ${counts}${note}`);
  for (const entry of values.write ? texts : result.wrapped) {
    const attr = entry.kind === 'attribute' ? `${entry.attribute} → ` : '';
    console.log(`  ${entry.file}:${entry.line}  ${attr}"${entry.text}"`);
  }
  if (result.skipped.length > 0) {
    console.log('  needs a human:');
    for (const entry of result.skipped) {
      console.log(`  ${entry.file}:${entry.line}  "${entry.text}" (${entry.reason})`);
    }
  }
  if (result.blocked.length > 0) {
    console.log(
      `  nothing written in ${counted(result.blocked.length, 'file')} with no t in scope:`,
    );
    for (const entry of result.blocked) {
      console.log(`  ${entry.file}  ${counted(entry.texts, 'text')}, ${entry.binding}`);
    }
    console.log('  next: add t there, run verbaly wrap --write again, then verbaly extract');
  } else if (values.write && done.length > 0) {
    console.log('  next: run verbaly extract');
  }
}
