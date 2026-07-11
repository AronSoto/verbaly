import { parseArgs } from 'node:util';
import { loadCatalogs, writeCatalog } from './catalog';
import { check, formatCheckResult } from './check';
import { writeDts } from './codegen';
import { loadConfig } from './config';
import { doctor } from './doctor';
import { exportCatalogs, importCatalogs, type ExchangeFormat } from './exchange';
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
  verbaly export     write translator-ready files per locale (XLIFF 2.0 or CSV)
  verbaly import <files…>  fill catalogs back from translated XLIFF/CSV files
  verbaly pseudo     generate a pseudo-locale catalog for i18n QA (default: en-XA)
  verbaly render     pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    extra locales; for translate: target locales to fill
  --prune            drop keys no longer referenced (extract)
  --model <id>       model override for the claude provider (translate)
  --dry-run          list what would happen, write nothing (translate, import, extract)
  --format <f>       export format: xliff (default) or csv (export)
  --out <path>       export directory (export, default: verbaly-export)
  --missing          export only untranslated entries (export)
  --overwrite        replace existing translations on import (import)
  --locale <id>      pseudo-locale id (pseudo) / target-locale override (import)
  --site <path>      built site directory (render, default: dist)
  --attribute <name> base data attribute (render, default: data-verbaly)
  --base-url <url>   site origin — enables hreflang alternates (render)
  --sitemap          emit sitemap-i18n.xml with per-locale alternates (render)
  --clean            remove existing locale dirs before mirroring (render)

Config file: verbaly.config.{js,mjs,ts,mts,json} at root (flags win).
The claude provider needs @anthropic-ai/sdk installed and ANTHROPIC_API_KEY set.
`;

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const { positionals, values } = parseArgs({
    args,
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
      format: { type: 'string' },
      out: { type: 'string' },
      missing: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    process.exitCode = command ? 0 : 1;
    return;
  }

  if (rejectStrayFlags(command, values)) return;

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
    const dryRun = values['dry-run'];
    const registry = await extractProject(cfg);
    const catalogs = loadCatalogs(cfg);
    if (values.prune) {
      const removed = pruneCatalogs(cfg, catalogs, registry);
      for (const [locale, keys] of Object.entries(removed)) {
        console.log(
          dryRun
            ? `  ${locale}: would prune ${keys.length} — ${keys.join(', ')}`
            : `  ${locale}: -${keys.length} pruned`,
        );
      }
    }
    const { added } = syncCatalogs(cfg, catalogs, registry);
    if (!dryRun) {
      for (const locale of cfg.locales) {
        writeCatalog(cfg, locale, catalogs[locale] ?? {});
      }
      writeDts(cfg, new Map(Object.entries(catalogs[cfg.sourceLocale] ?? {})));
    }
    const total = registry.messages().size;
    console.log(
      `[verbaly] ${total} messages · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
    );
    for (const [locale, keys] of Object.entries(added)) {
      console.log(`  ${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length}`}`);
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

  if (command === 'export') {
    const format = (values.format ?? 'xliff') as ExchangeFormat;
    if (format !== 'xliff' && format !== 'csv') {
      console.error(`[verbaly] unknown format "${values.format}" — use xliff or csv`);
      process.exitCode = 1;
      return;
    }
    const result = exportCatalogs(cfg, loadCatalogs(cfg), {
      locales: values.locales?.split(','),
      format,
      out: values.out,
      missing: values.missing,
    });
    if (result.files.length === 0) {
      console.log('[verbaly] no target locales to export (add locales to your config)');
      return;
    }
    console.log(`[verbaly] exported ${result.files.length} locales (${result.format}) → ${result.dir}`);
    for (const file of result.files) {
      console.log(`  ${file.locale}: ${file.total} messages (${file.untranslated} untranslated) → ${file.path}`);
    }
    return;
  }

  if (command === 'import') {
    const files = positionals.slice(1);
    if (files.length === 0) {
      console.error('[verbaly] import needs at least one file: verbaly import verbaly-export/es.xlf');
      process.exitCode = 1;
      return;
    }
    const catalogs = loadCatalogs(cfg);
    const result = importCatalogs(cfg, catalogs, files, {
      locale: values.locale,
      overwrite: values.overwrite,
      dryRun: values['dry-run'],
    });
    for (const [locale, keys] of Object.entries(result.imported)) {
      if (!values['dry-run']) writeCatalog(cfg, locale, catalogs[locale] ?? {});
      const verb = values['dry-run'] ? 'would import' : 'imported';
      console.log(`  ${locale}: +${keys.length} ${verb}`);
    }
    for (const [locale, keys] of Object.entries(result.skipped)) {
      console.log(`  ${locale}: ${keys.length} already translated, kept (use --overwrite to replace)`);
    }
    for (const [locale, keys] of Object.entries(result.rejected)) {
      console.warn(`  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`);
    }
    for (const [locale, keys] of Object.entries(result.unknown)) {
      console.warn(`  ${locale}: ${keys.length} unknown keys ignored (not in the source catalog): ${keys.join(', ')}`);
    }
    if (Object.keys(result.imported).length === 0) {
      console.log('[verbaly] nothing to import ✓');
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

// flags shared by every command (config overrides)
const COMMON_FLAGS = new Set(['root', 'dir', 'source', 'locales', 'help']);
const COMMAND_FLAGS: Record<string, string[]> = {
  init: [],
  doctor: [],
  extract: ['prune', 'dry-run'],
  check: [],
  translate: ['model', 'dry-run'],
  export: ['format', 'out', 'missing'],
  import: ['locale', 'overwrite', 'dry-run'],
  pseudo: ['locale'],
  render: ['site', 'attribute', 'base-url', 'sitemap', 'clean'],
};

// a flag another command owns must fail loudly, never be silently ignored
function rejectStrayFlags(command: string, values: Record<string, unknown>): boolean {
  const own = COMMAND_FLAGS[command];
  if (!own) return false; // unknown command — reported later with the help text
  const allowed = new Set([...COMMON_FLAGS, ...own]);
  const stray = Object.keys(values).filter((k) => values[k] !== undefined && !allowed.has(k));
  if (stray.length === 0) return false;
  for (const flag of stray) {
    const hint = flag === 'locale' ? ' — did you mean --locales?' : '';
    console.error(`[verbaly] --${flag} is not a "${command}" flag${hint}`);
  }
  process.exitCode = 1;
  return true;
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

