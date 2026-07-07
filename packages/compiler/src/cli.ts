#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadCatalogs, writeCatalog } from './catalog';
import { check, formatCheckResult } from './check';
import { writeDts } from './codegen';
import { loadConfig } from './config';
import { extractProject, pruneCatalogs, syncCatalogs } from './extract';
import { translateCatalogs, type TranslateProvider } from './translate';
import type { ResolvedConfig } from './config';

const HELP = `verbaly — i18n compiler

Usage:
  verbaly extract    scan sources, update catalogs and types
  verbaly check      verify translations are complete (CI)
  verbaly translate  fill missing translations via a provider (default: claude)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    extra locales; for translate: target locales to fill
  --prune            drop keys no longer referenced (extract)
  --model <id>       model override for the claude provider (translate)
  --dry-run          list what would be translated, write nothing (translate)

Config file: verbaly.config.{js,mjs,ts,mts,json} at root (flags win).
The claude provider needs @anthropic-ai/sdk installed and ANTHROPIC_API_KEY set.
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
      model: { type: 'string' },
      'dry-run': { type: 'boolean' },
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

  if (command === 'translate') {
    const catalogs = loadCatalogs(cfg);
    const provider = await resolveProvider(cfg, values.model);
    const result = await translateCatalogs(cfg, catalogs, provider, {
      locales: values.locales?.split(','),
      batchSize: cfg.translate.batchSize,
      dryRun: values['dry-run'],
    });

    if (values['dry-run']) {
      const entries = Object.entries(result.pending);
      if (entries.length === 0) {
        console.log('[verbaly] nothing to translate ✓');
        return;
      }
      for (const [locale, keys] of entries) {
        console.log(`  ${locale}: ${keys.length} missing — ${keys.join(', ')}`);
      }
      return;
    }

    for (const locale of Object.keys(result.translated)) {
      writeCatalog(cfg, locale, catalogs[locale] ?? {});
      console.log(`  ${locale}: +${result.translated[locale]!.length} translated`);
    }
    for (const [locale, keys] of Object.entries(result.invalid)) {
      console.warn(
        `  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
      );
    }
    if (Object.keys(result.translated).length === 0 && Object.keys(result.invalid).length === 0) {
      console.log('[verbaly] nothing to translate ✓');
    }
    return;
  }

  console.error(`[verbaly] unknown command "${command}"\n${HELP}`);
  process.exitCode = 1;
}

async function resolveProvider(
  cfg: ResolvedConfig,
  model: string | undefined,
): Promise<TranslateProvider> {
  const configured = cfg.translate.provider;
  if (typeof configured === 'function') return configured;
  const { claudeProvider } = await import('./providers/claude');
  return claudeProvider({ model: model ?? cfg.translate.model });
}

main().catch((error: unknown) => {
  console.error('[verbaly]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
