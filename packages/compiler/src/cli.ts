#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadCatalogs, writeCatalog } from './catalog';
import { check, formatCheckResult } from './check';
import { writeDts } from './codegen';
import { loadConfig } from './config';
import { extractProject, pruneCatalogs, syncCatalogs } from './extract';

const HELP = `verbaly — i18n compiler

Usage:
  verbaly extract   scan sources, update catalogs and types
  verbaly check     verify translations are complete (CI)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    extra locales (default: from catalog files)
  --prune            drop keys no longer referenced (extract)

Config file: verbaly.config.{js,mjs,json} at root (flags win).
`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      dir: { type: 'string' },
      source: { type: 'string' },
      locales: { type: 'string' },
      prune: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    process.exitCode = command ? 0 : 1;
    return;
  }

  const cfg = await loadConfig(values.root ?? process.cwd(), {
    dir: values.dir,
    sourceLocale: values.source,
    locales: values.locales?.split(','),
  });

  if (command === 'extract') {
    const registry = await extractProject(cfg);
    const catalogs = loadCatalogs(cfg);
    if (values.prune) {
      const removed = pruneCatalogs(cfg, catalogs, registry);
      for (const [locale, keys] of Object.entries(removed)) {
        console.log(`  ${locale}: -${keys.length} pruned`);
      }
    }
    const { added } = syncCatalogs(cfg, catalogs, registry);
    for (const locale of cfg.locales) {
      writeCatalog(cfg, locale, catalogs[locale] ?? {});
    }
    writeDts(cfg, new Map(Object.entries(catalogs[cfg.sourceLocale] ?? {})));
    const total = registry.messages().size;
    console.log(`[verbaly] ${total} messages · locales: ${cfg.locales.join(', ')}`);
    for (const [locale, keys] of Object.entries(added)) {
      console.log(`  ${locale}: +${keys.length}`);
    }
    return;
  }

  if (command === 'check') {
    const registry = await extractProject(cfg);
    const result = check(cfg, loadCatalogs(cfg), registry);
    if (result.ok) {
      console.log('[verbaly] all translations complete ✓');
      return;
    }
    console.error(`[verbaly] check failed\n${formatCheckResult(result)}`);
    process.exitCode = 1;
    return;
  }

  console.error(`[verbaly] unknown command "${command}"\n${HELP}`);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('[verbaly]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
