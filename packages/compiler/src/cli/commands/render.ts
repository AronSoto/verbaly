import type { ResolvedConfig } from '../../config/config';
import { formatRenderWarnings, renderSite } from '../../emit/render';
import { counted } from '../../util/text';
import { csv, type CliValues } from '../args';

export async function renderCommand(cfg: ResolvedConfig, values: CliValues): Promise<void> {
  const result = await renderSite(cfg, {
    site: values.site,
    locales: csv(values.locales),
    attribute: values.attribute,
    base: values.base,
    baseUrl: values['base-url'],
    sitemap: values.sitemap,
    redirect: values.redirect,
    clean: values.clean,
  });
  console.log(
    `[verbaly] ${counted(result.files, 'page')} × ${counted(result.locales.length, 'locale')} (${result.locales.join(', ')})`,
  );
  for (const line of formatRenderWarnings(result, cfg.sourceLocale)) console.warn(line);
}
