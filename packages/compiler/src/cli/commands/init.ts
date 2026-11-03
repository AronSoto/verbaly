import { init } from '../../project/init';
import { csv, type CliValues } from '../args';

export async function initCommand(values: CliValues): Promise<void> {
  const result = await init({
    root: values.root,
    dir: values.dir,
    sourceLocale: values.source,
    locales: csv(values.locales),
  });
  if (result.created.length) console.log(`[verbaly] created: ${result.created.join(', ')}`);
  if (result.skipped.length) console.log(`  kept (already there): ${result.skipped.join(', ')}`);
  for (const { from, to } of result.renamed) {
    console.log(`  wrote ${to} for ${from}, since a locale tag takes a hyphen`);
  }
  for (const locale of result.refused) {
    console.warn(`  left out "${locale}": it is not a locale tag, use one like es or pt-BR`);
  }
  if (result.found) console.log(`  catalogs: ${result.found}, kept where they already are`);
  if (result.host) console.log(`  detected: ${result.host}`);
  console.log(
    ['  next steps:', ...result.next.map((step, i) => `    ${i + 1}. ${step}`)].join('\n'),
  );
}
