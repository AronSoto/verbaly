#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadCatalogs, writeCatalog } from './catalog';
import { check, formatCheckResult } from './check';
import { writeDts } from './codegen';
import { loadConfig } from './config';
import { doctor } from './doctor';
import { extractProject, pruneCatalogs, syncCatalogs } from './extract';
import { init } from './init';
import { PSEUDO_LOCALE, pseudoCatalogs } from './pseudo';
import { renderSite } from './render';
import { translateCatalogs, type TranslateProvider } from './translate';
import type { ResolvedConfig } from './config';

const HELP = `verbaly — i18n compiler

Usage:
  verbaly init       scaffold config + locale catalogs (detects your bundler)
  verbaly doctor     diagnose the setup (config, catalogs, plugin, types, keys)
  verbaly extract    scan sources, update catalogs and types
  verbaly check      verify translations are complete (CI)
  verbaly translate  fill missing translations via a provider (default: claude)
  verbaly pseudo     generate a pseudo-locale catalog for i18n QA (default: en-XA)
  verbaly render     pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    extra locales; for translate: target locales to fill
  --prune            drop keys no longer referenced (extract)
  --model <id>       model override for the claude provider (translate)
  --dry-run          list what would be translated, write nothing (translate)
  --locale <id>      pseudo-locale id (pseudo, default: en-XA)
  --site <path>      built site directory (render, default: dist)
  --attribute <name> base data attribute (render, default: data-verbaly)
  --base-url <url>   site origin — enables hreflang alternates (render)
  --sitemap          emit sitemap-i18n.xml with per-locale alternates (render)
  --clean            remove existing locale dirs before mirroring (render)

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
      locale: { type: 'string' },
      site: { type: 'string' },
      attribute: { type: 'string' },
      'base-url': { type: 'string' },
      sitemap: { type: 'boolean' },
      clean: { type: 'boolean' },
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

  if (command === 'init') {
    const result = init({
      root: values.root,
      dir: values.dir,
      sourceLocale: values.source,
      locales: values.locales?.split(','),
    });
    if (result.created.length) console.log(`[verbaly] created: ${result.created.join(', ')}`);
    if (result.skipped.length) console.log(`  kept (already there): ${result.skipped.join(', ')}`);
    if (result.bundler) console.log(`  detected bundler: ${result.bundler}`);
    console.log(
      ['  next steps:', ...result.next.map((step, i) => `    ${i + 1}. ${step}`)].join('\n'),
    );
    return;
  }

  const cfg = await loadConfig(values.root ?? process.cwd(), {
    dir: values.dir,
    sourceLocale: values.source,
    locales: values.locales?.split(','),
  });

  if (command === 'doctor') {
    const result = await doctor(cfg);
    const icon = { ok: '✓', warn: '⚠', error: '✗' } as const;
    console.log(`[verbaly] doctor — ${result.entries.length} checks`);
    for (const entry of result.entries) {
      const line = `  ${icon[entry.level]} ${entry.check}: ${entry.message}`;
      if (entry.level === 'error') console.error(line);
      else if (entry.level === 'warn') console.warn(line);
      else console.log(line);
      if (entry.fix) console.log(`      fix: ${entry.fix}`);
    }
    if (result.ok) {
      console.log('[verbaly] setup looks healthy ✓');
    } else {
      console.error('[verbaly] doctor found problems');
      process.exitCode = 1;
    }
    return;
  }

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

  if (command === 'render') {
    const result = await renderSite(cfg, {
      site: values.site,
      locales: values.locales?.split(','),
      attribute: values.attribute,
      baseUrl: values['base-url'],
      sitemap: values.sitemap,
      clean: values.clean,
    });
    console.log(
      `[verbaly] ${result.files} pages × ${result.locales.length} locales (${result.locales.join(', ')})`,
    );
    for (const [locale, keys] of Object.entries(result.missing)) {
      console.warn(`  ${locale}: ${keys.length} keys not pre-filled — ${keys.join(', ')}`);
    }
    return;
  }

  if (command === 'pseudo') {
    const catalogs = loadCatalogs(cfg);
    const locale = values.locale ?? PSEUDO_LOCALE;
    const keys = pseudoCatalogs(cfg, catalogs, locale);
    writeCatalog(cfg, locale, catalogs[locale] ?? {});
    console.log(`[verbaly] ${keys.length} messages pseudo-localized → ${locale}`);
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
