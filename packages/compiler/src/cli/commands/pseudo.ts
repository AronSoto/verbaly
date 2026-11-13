import { loadCatalogs, writeCatalog } from '../../catalog/catalog';
import { pseudoCatalogs } from '../../catalog/pseudo';
import { PSEUDO_LOCALE, type ResolvedConfig } from '../../config/config';
import { extractProject } from '../../scan/extract';
import { shippedCatalogs } from '../../scan/sync';
import { counted } from '../../util/text';
import type { CliValues } from '../args';

export async function pseudoCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  // the text that ships is the one QA has to see stretched, never a catalog the code moved past
  const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), await extractProject(cfg), {
    newKeys: false,
  });
  const locale = values.locale ?? PSEUDO_LOCALE;
  const keys = pseudoCatalogs(cfg, catalogs, locale);
  writeCatalog(cfg, locale, catalogs[locale] ?? {});
  console.log(`[verbaly] ${counted(keys.length, 'message')} pseudo-localized → ${locale}`);
}
