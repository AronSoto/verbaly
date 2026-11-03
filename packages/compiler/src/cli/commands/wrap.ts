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
  const counts = values.write
    ? `${counted(texts.length, 'text')} in ${counted(done.length, 'file')}`
    : `${counted(result.wrapped.length, 'text')} in ${counted(result.changed.length, 'file')}`;
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
      const how = entry.client
        ? '"use client", so const t = useT()'
        : 'no "use client": check which side renders it before you pick the binding';
      console.log(`  ${entry.file}  ${counted(entry.texts, 'text')}, ${how}`);
    }
    console.log('  next: add t there, run verbaly wrap --write again, then verbaly extract');
  } else if (values.write && done.length > 0) {
    console.log('  next: run verbaly extract');
  }
}
