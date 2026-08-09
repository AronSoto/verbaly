import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCatalogs, writeCatalog } from './catalog';
import {
  check,
  checkNextSteps,
  formatCheckResult,
  formatCheckWarnings,
  githubCheckAnnotations,
} from './check';
import { writeDts } from './codegen';
import { loadConfig, type ResolvedConfig } from './config';
import { doctor } from './doctor';
import { clearDrafts, effectiveDrafts, loadDrafts, markDrafts, saveDrafts } from './drafts';
import { exportCatalogs, importCatalogs, isMobileFormat, type ExportFormat } from './exchange';
import { collectOrigins, extractProject, pruneCatalogs, syncCatalogs } from './extract';
import { init } from './init';
import { PSEUDO_LOCALE, pseudoCatalogs } from './pseudo';
import { renderSite } from './render';
import type { MessageRegistry } from './registry';
import { formatStatusResult, status } from './status';
import { resolveProvider, translateCatalogs } from './translate';
import { escapedSyntax } from './validate';
import { watchProject } from './watch';
import { wrapProject } from './wrap';

const HELP = `verbaly · i18n compiler

Usage:
  verbaly init       scaffold config + locale catalogs (detects your framework)
  verbaly doctor     diagnose the setup (config, catalogs, plugin, types, keys)
  verbaly wrap       find hardcoded JSX text and wrap it in t\`…\` (report; --write applies)
  verbaly extract    scan sources, update catalogs and types
  verbaly status     translation coverage per locale, at a glance
  verbaly check      verify translations are complete (CI)
  verbaly translate  fill missing translations via a provider (default: claude)
  verbaly review     list machine translations awaiting review (--approve marks them reviewed)
  verbaly export     write translator files (XLIFF 2.0, CSV, gettext PO) or mobile resources (Android, iOS)
  verbaly import <files…>  fill catalogs back from translated XLIFF/CSV/PO files
  verbaly pseudo     generate a pseudo-locale catalog for i18n QA (default: en-XA)
  verbaly render     pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    extra locales; for translate: target locales to fill
  --prune            drop keys no longer referenced (extract)
  --watch            keep extracting as source files change (extract)
  --write            apply the rewrites instead of only reporting (wrap)
  --json             machine-readable output (status)
  --drafts           also fail on unreviewed machine translations (check)
  --approve          mark listed drafts as reviewed (review)
  --reporter <name>  failure format: text (default) or github annotations (check)
  --model <id>       model override for the claude provider (translate)
  --dry-run          list what would happen, write nothing (translate, import, extract)
  --format <f>       export format: xliff (default), csv, po, android-xml or ios-strings (export)
  --out <path>       export directory (export, default: verbaly-export)
  --missing          export only untranslated entries (export)
  --overwrite        replace existing translations on import (import)
  --locale <id>      pseudo-locale id (pseudo) / one locale only (review, import)
  --site <path>      built site directory (render, default: dist)
  --attribute <name> base data attribute (render, default: data-verbaly)
  --base <path>      subpath the site is served under, e.g. /app (render)
  --base-url <url>   site origin, enables hreflang alternates (render)
  --sitemap          emit sitemap-i18n.xml with per-locale alternates (render)
  --redirect         send a visitor on the root to their mirror, pre-paint (render)
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
      watch: { type: 'boolean' },
      write: { type: 'boolean' },
      json: { type: 'boolean' },
      drafts: { type: 'boolean' },
      approve: { type: 'boolean' },
      reporter: { type: 'string' },
      model: { type: 'string' },
      locale: { type: 'string' },
      site: { type: 'string' },
      attribute: { type: 'string' },
      base: { type: 'string' },
      'base-url': { type: 'string' },
      redirect: { type: 'boolean' },
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
    if (result.host) console.log(`  detected: ${result.host}`);
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
    console.log(`[verbaly] doctor: ${plural(result.entries.length, 'check')}`);
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
    if (values.watch && (dryRun || values.prune)) {
      console.error(
        '[verbaly] --watch runs alone: prune is a deliberate one-shot action and dry-run writes nothing',
      );
      process.exitCode = 1;
      return;
    }

    async function runExtract(): Promise<void> {
      const registry = await extractProject(cfg);
      const catalogs = loadCatalogs(cfg);
      if (values.prune) {
        const removed = pruneCatalogs(cfg, catalogs, registry);
        for (const [locale, keys] of Object.entries(removed)) {
          console.log(
            dryRun
              ? `  ${locale}: would prune ${keys.length}: ${keys.join(', ')}`
              : `  ${locale}: -${keys.length} pruned`,
          );
        }
      }
      const { added } = syncCatalogs(cfg, catalogs, registry);
      if (!dryRun) {
        for (const locale of cfg.locales) {
          writeCatalog(cfg, locale, catalogs[locale] ?? {});
        }
        if (cfg.dts !== false) writeDts(cfg, catalogs[cfg.sourceLocale] ?? {}, cfg.dts);
      }
      const total = registry.messages().size;
      console.log(
        `[verbaly] ${plural(total, 'message')} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
      );
      for (const [locale, keys] of Object.entries(added)) {
        console.log(`  ${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length}`}`);
      }
      reportParseErrors(cfg, registry);
      reportEscapedSyntax(cfg, registry);
    }

    await runExtract();
    if (values.watch) {
      watchProject(cfg, runExtract);
      console.log('[verbaly] watching for source changes (ctrl+c to stop)');
    }
    return;
  }

  if (command === 'wrap') {
    const result = await wrapProject(cfg, { write: values.write });
    if (result.wrapped.length === 0 && result.skipped.length === 0) {
      console.log(`[verbaly] nothing to wrap (${plural(result.files, 'file')} scanned) ✓`);
      return;
    }
    const verb = values.write ? 'wrapped' : 'would wrap';
    const note = values.write ? '' : ' (report only, use --write to apply)';
    console.log(
      `[verbaly] ${verb} ${plural(result.wrapped.length, 'text')} in ${plural(result.changed.length, 'file')}${note}`,
    );
    for (const entry of result.wrapped) {
      const attr = entry.kind === 'attribute' ? `${entry.attribute} → ` : '';
      console.log(`  ${entry.file}:${entry.line}  ${attr}"${entry.text}"`);
    }
    if (result.skipped.length > 0) {
      console.log('  needs a human:');
      for (const entry of result.skipped) {
        console.log(`  ${entry.file}:${entry.line}  "${entry.text}" (${entry.reason})`);
      }
    }
    if (values.write && result.changed.length > 0) {
      console.log(
        '  next: make t available where TS complains (React: const t = useT()), then run verbaly extract',
      );
    }
    return;
  }

  if (command === 'status') {
    const registry = await extractProject(cfg);
    const result = status(cfg, loadCatalogs(cfg), registry, loadDrafts(cfg));
    console.log(values.json ? JSON.stringify(result) : formatStatusResult(result));
    return;
  }

  if (command === 'check') {
    const reporter = values.reporter ?? 'text';
    if (reporter !== 'text' && reporter !== 'github') {
      console.error(`[verbaly] unknown reporter "${values.reporter}", use text or github`);
      process.exitCode = 1;
      return;
    }
    const registry = await extractProject(cfg);
    const catalogs = loadCatalogs(cfg);
    const result = check(cfg, catalogs, registry);
    // opt-in: unreviewed machine translations block the merge too
    const unreviewed = values.drafts ? effectiveDrafts(loadDrafts(cfg), catalogs) : {};
    const draftKeys = Object.entries(unreviewed);
    // the annotations carry both severities, so they print whether the gate passes or not
    if (reporter === 'github') {
      for (const line of githubCheckAnnotations(result, registry, cfg.root)) {
        console.error(line);
      }
    } else {
      const warnings = formatCheckWarnings(result);
      if (warnings) console.warn(`[verbaly] warnings (the gate still passes)\n${warnings}`);
    }

    if (result.ok && draftKeys.length === 0) {
      console.log('[verbaly] all translations complete ✓');
      return;
    }
    if (result.ok && draftKeys.length > 0) {
      for (const [locale, keys] of draftKeys) {
        console.error(`  [${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`);
      }
      console.error(
        '[verbaly] check failed: machine translations awaiting review (run verbaly review --approve)',
      );
      process.exitCode = 1;
      return;
    }
    const brokenCount = result.broken.filter((entry) => entry.severity === 'error').length;
    const report =
      reporter === 'github'
        ? `[verbaly] check failed: ${result.missing.length} missing, ${result.unknown.length} unknown, ${brokenCount} broken`
        : `[verbaly] check failed\n${formatCheckResult(result)}`;
    console.error(`${report}\n${checkNextSteps(result)}`);
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
      // dry-run never calls the provider: skip the full extract origins need
      origins: values['dry-run'] ? undefined : await collectOrigins(cfg),
    });

    if (values['dry-run']) {
      const entries = Object.entries(result.pending);
      if (entries.length === 0) {
        console.log('[verbaly] nothing to translate ✓');
        return;
      }
      for (const [locale, keys] of entries) {
        console.log(`  ${locale}: ${keys.length} missing: ${keys.join(', ')}`);
      }
      return;
    }

    // machine output is a draft until a human reviews it (verbaly review / import)
    const drafts = loadDrafts(cfg);
    for (const locale of Object.keys(result.translated)) {
      writeCatalog(cfg, locale, catalogs[locale] ?? {});
      markDrafts(drafts, locale, result.translated[locale]!);
      console.log(`  ${locale}: +${result.translated[locale]!.length} translated (draft)`);
    }
    if (Object.keys(result.translated).length > 0) saveDrafts(cfg, drafts);
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

  if (command === 'review') {
    const catalogs = loadCatalogs(cfg);
    const drafts = loadDrafts(cfg);
    const live = effectiveDrafts(drafts, catalogs);
    const targets = values.locale ? { [values.locale]: live[values.locale] ?? [] } : live;
    const entries = Object.entries(targets).filter(([, keys]) => keys.length);

    if (entries.length === 0) {
      console.log('[verbaly] no machine translations awaiting review ✓');
      return;
    }

    if (values.approve) {
      let count = 0;
      for (const [locale, keys] of entries) {
        clearDrafts(drafts, locale, keys);
        count += keys.length;
        console.log(`  ${locale}: ${keys.length} approved`);
      }
      saveDrafts(cfg, drafts);
      console.log(`[verbaly] ${count} translations marked reviewed ✓`);
      return;
    }

    const total = entries.reduce((sum, [, keys]) => sum + keys.length, 0);
    console.log(`[verbaly] ${total} machine translations awaiting review (--approve to accept)`);
    for (const [locale, keys] of entries) {
      console.log(`  ${locale}: ${keys.join(', ')}`);
    }
    return;
  }

  if (command === 'export') {
    const format = (values.format ?? 'xliff') as ExportFormat;
    if (!['xliff', 'csv', 'po', 'android-xml', 'ios-strings'].includes(format)) {
      console.error(
        `[verbaly] unknown format "${values.format}", use xliff, csv, po, android-xml or ios-strings`,
      );
      process.exitCode = 1;
      return;
    }
    if (values.missing && isMobileFormat(format)) {
      console.error(
        `[verbaly] --missing is for translator formats (xliff, csv): ${format} already skips untranslated keys so the app falls back to the source locale`,
      );
      process.exitCode = 1;
      return;
    }
    const result = exportCatalogs(cfg, loadCatalogs(cfg), {
      locales: values.locales?.split(','),
      format,
      out: values.out,
      missing: values.missing,
      // mobile formats are delivery-only: no translator reads them, skip the scan
      origins: isMobileFormat(format) ? undefined : await collectOrigins(cfg),
    });
    if (result.files.length === 0) {
      console.log('[verbaly] no target locales to export (add locales to your config)');
      return;
    }
    const note = isMobileFormat(result.format) ? 'untranslated skipped' : 'untranslated';
    console.log(
      `[verbaly] exported ${result.files.length} locales (${result.format}) → ${result.dir}`,
    );
    for (const file of result.files) {
      console.log(
        `  ${file.locale}: ${file.total} messages (${file.untranslated} ${note}) → ${file.path}`,
      );
    }
    return;
  }

  if (command === 'import') {
    const files = positionals.slice(1);
    if (files.length === 0) {
      console.error(
        '[verbaly] import needs at least one file: verbaly import verbaly-export/es.xlf',
      );
      process.exitCode = 1;
      return;
    }
    const catalogs = loadCatalogs(cfg);
    const result = importCatalogs(cfg, catalogs, files, {
      locale: values.locale,
      overwrite: values.overwrite,
      dryRun: values['dry-run'],
    });
    // a human file clears the machine-draft flag: the imported text is reviewed
    const drafts = loadDrafts(cfg);
    let draftsChanged = false;
    for (const [locale, keys] of Object.entries(result.imported)) {
      if (!values['dry-run']) {
        writeCatalog(cfg, locale, catalogs[locale] ?? {});
        clearDrafts(drafts, locale, keys);
        draftsChanged = true;
      }
      const verb = values['dry-run'] ? 'would import' : 'imported';
      console.log(`  ${locale}: +${keys.length} ${verb}`);
    }
    if (draftsChanged) saveDrafts(cfg, drafts);
    for (const [locale, keys] of Object.entries(result.skipped)) {
      console.log(
        `  ${locale}: ${keys.length} already translated, kept (use --overwrite to replace)`,
      );
    }
    for (const [locale, keys] of Object.entries(result.rejected)) {
      console.warn(
        `  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
      );
    }
    for (const [locale, keys] of Object.entries(result.unknown)) {
      console.warn(
        `  ${locale}: ${keys.length} unknown keys ignored (not in the source catalog): ${keys.join(', ')}`,
      );
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
      base: values.base,
      baseUrl: values['base-url'],
      sitemap: values.sitemap,
      redirect: values.redirect,
      clean: values.clean,
    });
    console.log(
      `[verbaly] ${plural(result.files, 'page')} × ${plural(result.locales.length, 'locale')} (${result.locales.join(', ')})`,
    );
    for (const [locale, keys] of Object.entries(result.missing)) {
      console.warn(`  ${locale}: ${plural(keys.length, 'key')} not pre-filled: ${keys.join(', ')}`);
    }
    return;
  }

  if (command === 'pseudo') {
    const catalogs = loadCatalogs(cfg);
    const locale = values.locale ?? PSEUDO_LOCALE;
    const keys = pseudoCatalogs(cfg, catalogs, locale);
    writeCatalog(cfg, locale, catalogs[locale] ?? {});
    console.log(`[verbaly] ${plural(keys.length, 'message')} pseudo-localized → ${locale}`);
    return;
  }

  console.error(`[verbaly] unknown command "${command}"\n${HELP}`);
  process.exitCode = 1;
}

// every compiler error already opens with [verbaly]: prefix only what does not
export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('[verbaly]') ? message : `[verbaly] ${message}`;
}

// counts read like text, so the tool that translates apps never prints "1 messages"
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

// the file is named because babel's message never is: a bare position is unactionable
function reportParseErrors(cfg: ResolvedConfig, registry: MessageRegistry): void {
  for (const { file, message } of registry.parseErrors()) {
    const rel = relative(cfg.root, file).replaceAll('\\', '/');
    console.warn(`  ${rel}: could not be parsed (${message}), its messages were not extracted`);
  }
}

// a block inside a tagged template ships as literal braces, and nothing else in the cycle sees it
function reportEscapedSyntax(cfg: ResolvedConfig, registry: MessageRegistry): void {
  for (const msg of registry.messages().values()) {
    const slice = escapedSyntax(msg.message);
    if (!slice) continue;
    const file = relative(cfg.root, msg.file).replaceAll('\\', '/');
    console.warn(`  ${file}: ${slice} renders as literal text, a tagged template has no params`);
    console.warn('    use t(key, params) for a plural or format block, or pass a ${…} value');
  }
}

// flags shared by every command (config overrides)
const COMMON_FLAGS = new Set(['root', 'dir', 'source', 'locales', 'help']);
const COMMAND_FLAGS: Record<string, string[]> = {
  init: [],
  doctor: [],
  extract: ['prune', 'dry-run', 'watch'],
  wrap: ['write'],
  status: ['json'],
  check: ['reporter', 'drafts'],
  translate: ['model', 'dry-run'],
  review: ['approve', 'locale'],
  export: ['format', 'out', 'missing'],
  import: ['locale', 'overwrite', 'dry-run'],
  pseudo: ['locale'],
  render: ['site', 'attribute', 'base', 'base-url', 'sitemap', 'redirect', 'clean'],
};

// a flag another command owns must fail loudly, never be silently ignored
function rejectStrayFlags(command: string, values: Record<string, unknown>): boolean {
  const own = COMMAND_FLAGS[command];
  if (!own) return false; // unknown command: reported later with the help text
  const allowed = new Set([...COMMON_FLAGS, ...own]);
  const stray = Object.keys(values).filter((k) => values[k] !== undefined && !allowed.has(k));
  if (stray.length === 0) return false;
  for (const flag of stray) {
    const hint = flag === 'locale' ? ' (did you mean --locales?)' : '';
    console.error(`[verbaly] --${flag} is not a "${command}" flag${hint}`);
  }
  process.exitCode = 1;
  return true;
}
