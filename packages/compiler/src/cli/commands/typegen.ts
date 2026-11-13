import { loadCatalogs } from '../../catalog/catalog';
import type { ResolvedConfig } from '../../config/config';
import { writeDts } from '../../emit/codegen';
import { extractProject } from '../../scan/extract';
import { shippedCatalogs } from '../../scan/sync';
import { counted } from '../../util/text';
import { relativePath } from '../../util/path';

export async function typegenCommand(cfg: ResolvedConfig): Promise<void> {
  const registry = await extractProject(cfg);
  // the types describe the text that ships, the code's text wherever the code owns one
  const source = shippedCatalogs(cfg, loadCatalogs(cfg), registry)[cfg.sourceLocale] ?? {};
  const written = writeDts(cfg, source);
  if (!written) {
    console.log('[verbaly] no types written: dts is false in your verbaly config');
    return;
  }
  const where = relativePath(cfg.root, written.file);
  const how = written.changed ? 'written to' : 'up to date in';
  console.log(
    `[verbaly] types ${how} ${where} (${counted(Object.keys(source).length, 'message')})`,
  );
}
