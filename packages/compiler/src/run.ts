import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { loadCatalogs, writeCatalog } from './catalog';
import {
  check,
  checkNextSteps,
  collisionEntries,
  formatCheckResult,
  formatCheckWarnings,
  formatCollision,
  githubCheckAnnotations,
} from './check';
import { writeDts } from './codegen';
import { loadConfig, type ResolvedConfig } from './config';
import { doctor, formatDoctorEntry } from './doctor';
import { clearDrafts, effectiveDrafts, loadDrafts, markDrafts, saveDrafts } from './drafts';
import { exportCatalogs, importCatalogs, isMobileFormat, type ExportFormat } from './exchange';
import { collectOrigins, extractProject, pruneCatalogs, syncCatalogs } from './extract';
import { init } from './init';
import { migrateCatalogs } from './migrate';
import { PSEUDO_LOCALE, pseudoCatalogs } from './pseudo';
import { formatRenderWarnings, renderSite } from './render';
import { createLocator } from './location';
import type { MessageRegistry } from './registry';
import {
  acceptOutdated,
  loadState,
  outdatedTranslations,
  saveState,
  updateState,
  type State,
} from './state';
import { formatStatusResult, status } from './status';
import { counted } from './text';
import {
  formatTranslateFailures,
  mergeTranslations,
  resolveProvider,
  translateCatalogs,
  type TranslateProgress,
} from './translate';
import { escapedSyntax } from './validate';
import { watchProject } from './watch';
import { wrapProject } from './wrap';

const HELP = `verbaly · i18n compiler

Usage:
  verbaly init       scaffold config + locale catalogs (detects your framework)
  verbaly doctor     diagnose the setup (config, catalogs, plugin, types, keys)
  verbaly wrap       find hardcoded JSX text and wrap it in t\`…\` (report; --write applies)
  verbaly migrate    port catalogs from another i18n library (report; --write applies)
  verbaly extract    scan sources, update catalogs and types
  verbaly status     translation coverage per locale, at a glance
  verbaly check      verify translations are complete (CI)
  verbaly translate  fill missing translations via a provider (default: claude)
  verbaly review     list translations awaiting review: machine drafts and outdated ones (--approve accepts them)
  verbaly export     write translator files (XLIFF 2.0, CSV, gettext PO) or mobile resources (Android, iOS)
  verbaly import <files…>  fill catalogs back from translated XLIFF/CSV/PO files
  verbaly pseudo     generate a pseudo-locale catalog for i18n QA (default: en-XA)
  verbaly render     pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    run on these locales only, the source always included (init: the ones to create)
  --prune            drop keys no longer referenced (extract)
  --watch            keep extracting as source files change (extract)
  --write            apply the rewrites instead of only reporting (wrap, migrate)
  --plurals          also merge _one/_other into one message with variants (migrate)
  --json             machine-readable output (status)
  --drafts           also fail on unreviewed machine translations (check)
  --outdated         also fail on translations written for an older source text (check)
  --approve          mark listed drafts as reviewed (review)
  --reporter <name>  failure format: text (default) or github annotations (check)
  --model <id>       model override for the claude provider (translate)
  --dry-run          list what would happen, write nothing (translate, import, extract)
  --format <f>       export format: xliff (default), csv, po, android-xml or ios-strings (export)
  --out <path>       export directory (export, default: verbaly-export)
  --missing          export only untranslated entries (export)
  --overwrite        replace existing translations on import (import)
  --draft            mark what the files bring as drafts a person still has to review (import)
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
      outdated: { type: 'boolean' },
      draft: { type: 'boolean' },
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
      plurals: { type: 'boolean' },
      format: { type: 'string' },
      out: { type: 'string' },
      missing: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const command = positionals[0];
  // asking for help is not a usage error, even with no command: only bare `verbaly` is
  if (values.help || !command) {
    console.log(HELP);
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  if (rejectStrayFlags(command, values)) return;

  if (command === 'init') {
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
    if (result.host) console.log(`  detected: ${result.host}`);
    console.log(
      ['  next steps:', ...result.next.map((step, i) => `    ${i + 1}. ${step}`)].join('\n'),
    );
    return;
  }

  const cfg = await loadConfig(values.root ?? process.cwd(), {
    dir: values.dir,
    sourceLocale: values.source,
    locales: csv(values.locales),
  });

  if (command === 'doctor') {
    const result = await doctor(cfg);
    console.log(`[verbaly] doctor: ${counted(result.entries.length, 'check')}`);
    for (const entry of result.entries) {
      const line = formatDoctorEntry(entry);
      if (entry.level === 'error') console.error(line);
      else if (entry.level === 'warn') console.warn(line);
      else console.log(line);
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
        const unread = registry.parseErrors().length;
        if (unread > 0) {
          console.warn(
            `  prune skipped: an unparsed file may read any key (${counted(unread, 'file')} below), so it waits until every file parses`,
          );
        }
        for (const [locale, keys] of Object.entries(removed)) {
          console.log(
            dryRun
              ? `  ${locale}: would prune ${keys.length}: ${keys.join(', ')}`
              : `  ${locale}: -${keys.length} pruned`,
          );
        }
      }
      const { added, replaced } = syncCatalogs(cfg, catalogs, registry);
      if (!dryRun) {
        for (const locale of cfg.locales) {
          writeCatalog(cfg, locale, catalogs[locale] ?? {});
        }
        writeDts(cfg, catalogs[cfg.sourceLocale] ?? {});
        // drafts and fingerprints follow the catalogs, so a pruned key takes its draft with it
        updateState(cfg, catalogs);
      }
      const total = registry.messages().size;
      console.log(
        `[verbaly] ${counted(total, 'message')} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
      );
      for (const [locale, keys] of Object.entries(added)) {
        console.log(`  ${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length}`}`);
      }
      reportReplaced(cfg, registry, replaced, dryRun);
      for (const entry of collisionEntries(registry)) console.warn(formatCollision(entry, cfg.root));
      reportParseErrors(cfg, registry);
      reportEscapedSyntax(cfg, registry);
      reportMissed(cfg, registry);
      reportPositional(cfg, registry);
    }

    await runExtract();
    if (values.watch) {
      watchProject(cfg, runExtract);
      console.log('[verbaly] watching for source changes (ctrl+c to stop)');
    }
    return;
  }

  if (command === 'migrate') {
    const result = migrateCatalogs(cfg, { write: values.write, plurals: values.plurals });
    const from = result.detected.length ? result.detected.join(', ') : 'no known i18n library';
    const changes = result.braces.length + result.plurals.length;
    if (changes === 0 && result.skipped.length === 0) {
      console.log(`[verbaly] catalogs need nothing (${from}) ✓`);
      return;
    }
    const verb = values.write ? 'ported' : 'would port';
    const note = values.write ? '' : ' (report only, use --write to apply)';
    console.log(`[verbaly] ${verb} ${counted(changes, 'message')} from ${from}${note}`);
    for (const entry of result.braces) {
      console.log(`  ${entry.locale} ${entry.key}  ${entry.before} → ${entry.after}`);
    }
    for (const entry of result.plurals) {
      console.log(`  ${entry.locale} ${entry.key}  ${entry.from.join(' + ')} → ${entry.after}`);
    }
    if (!values.plurals && changes > 0) {
      console.log('  --plurals also merges _one/_other into one message with variants');
    }
    if (result.skipped.length > 0) {
      console.log('  needs a human:');
      for (const entry of result.skipped) {
        console.log(`  ${entry.locale} ${entry.key}  ${entry.reason}`);
      }
    }
    if (values.write) console.log('  next: run verbaly check');
    return;
  }

  if (command === 'wrap') {
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
      console.log(`  nothing written in ${counted(result.blocked.length, 'file')} with no t in scope:`);
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
    return;
  }

  if (command === 'status') {
    const registry = await extractProject(cfg);
    const state = loadState(cfg);
    const result = status(cfg, loadCatalogs(cfg), registry, state.drafts, state.fingerprints);
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
    const state = checkState(cfg, values.drafts === true || values.outdated === true);
    const result = check(cfg, catalogs, registry, state.fingerprints);
    // opt-in: unreviewed machine translations and outdated ones block the merge too
    const unreviewed = values.drafts ? effectiveDrafts(state.drafts, catalogs) : {};
    const draftKeys = Object.entries(unreviewed);
    const outdated = values.outdated ? result.outdated : [];
    // the annotations carry both severities, so they print whether the gate passes or not
    if (reporter === 'github') {
      for (const line of githubCheckAnnotations(result, registry, cfg.root)) {
        console.error(line);
      }
    } else {
      const warnings = formatCheckWarnings(result, cfg.root);
      if (warnings) console.warn(`[verbaly] warnings (the gate still passes)\n${warnings}`);
    }

    if (result.ok && draftKeys.length === 0 && outdated.length === 0) {
      console.log('[verbaly] all translations complete ✓');
      return;
    }
    if (result.ok) {
      for (const [locale, keys] of draftKeys) {
        console.error(`  [${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`);
      }
      for (const [locale, keys] of byLocale(outdated)) {
        console.error(`  [${locale}] ${keys.length} outdated: ${keys.join(', ')}`);
      }
      console.error(
        '[verbaly] check failed: translations awaiting review (run verbaly review, then --approve what holds)',
      );
      process.exitCode = 1;
      return;
    }
    const brokenCount = result.broken.filter((entry) => entry.severity === 'error').length;
    const report =
      reporter === 'github'
        ? `[verbaly] check failed: ${result.missing.length} missing, ${result.unknown.length} unknown, ${brokenCount} broken`
        : `[verbaly] check failed\n${formatCheckResult(result, cfg.root)}`;
    console.error(`${report}\n${checkNextSteps(result)}`);
    process.exitCode = 1;
    return;
  }

  if (command === 'translate') {
    const catalogs = loadCatalogs(cfg);
    const provider = await resolveProvider(cfg, values.model);
    const result = await translateCatalogs(cfg, catalogs, provider, {
      locales: csv(values.locales),
      batchSize: cfg.translate.batchSize,
      concurrency: cfg.translate.concurrency,
      retries: cfg.translate.retries,
      dryRun: values['dry-run'],
      // dry-run never calls the provider: skip the full extract origins need
      origins: values['dry-run'] ? undefined : await collectOrigins(cfg),
      onProgress: values['dry-run'] ? undefined : reportProgress,
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
    for (const [locale, keys] of Object.entries(result.translated)) {
      const written = mergeTranslations(cfg, locale, catalogs[locale] ?? {}, keys);
      markDrafts(drafts, locale, written);
      console.log(`  ${locale}: +${written.length} translated (draft)`);
      const kept = keys.length - written.length;
      if (kept > 0) {
        console.log(`  ${locale}: ${counted(kept, 'message')} kept as written while this ran`);
      }
    }
    if (Object.keys(result.translated).length > 0) saveDrafts(cfg, drafts);
    for (const [locale, keys] of Object.entries(result.invalid)) {
      console.warn(
        `  ${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
      );
    }
    for (const line of formatTranslateFailures(result.failed)) console.error(line);
    if (result.failed.length > 0) process.exitCode = 1;
    if (
      Object.keys(result.translated).length === 0 &&
      Object.keys(result.invalid).length === 0 &&
      result.failed.length === 0
    ) {
      console.log('[verbaly] nothing to translate ✓');
    }
    return;
  }

  if (command === 'review') {
    const catalogs = loadCatalogs(cfg);
    const state = loadState(cfg);
    const live = effectiveDrafts(state.drafts, catalogs);
    const targets = values.locale ? { [values.locale]: live[values.locale] ?? [] } : live;
    const entries = Object.entries(targets).filter(([, keys]) => keys.length);
    const outdated = outdatedTranslations(cfg, catalogs, state.fingerprints).filter(
      (entry) => !values.locale || entry.locale === values.locale,
    );

    if (entries.length === 0 && outdated.length === 0) {
      console.log('[verbaly] nothing awaiting review ✓');
      return;
    }

    if (values.approve) {
      let count = 0;
      for (const [locale, keys] of entries) {
        clearDrafts(state.drafts, locale, keys);
        count += keys.length;
        console.log(`  ${locale}: ${keys.length} approved`);
      }
      // a person read the old translation against the new source and kept it
      acceptOutdated(cfg, catalogs, state.fingerprints, outdated);
      for (const [locale, keys] of byLocale(outdated)) {
        console.log(`  ${locale}: ${keys.length} kept for the new source text`);
        count += keys.length;
      }
      saveState(cfg, state);
      console.log(`[verbaly] ${counted(count, 'translation')} marked reviewed ✓`);
      return;
    }

    if (entries.length > 0) {
      const total = entries.reduce((sum, [, keys]) => sum + keys.length, 0);
      console.log(
        `[verbaly] ${counted(total, 'machine translation')} awaiting review (--approve to accept)`,
      );
      for (const [locale, keys] of entries) {
        console.log(`  ${locale}: ${keys.join(', ')}`);
      }
    }
    if (outdated.length > 0) {
      console.log(
        `[verbaly] ${counted(outdated.length, 'translation')} written for an older source text (update them, or --approve keeps them)`,
      );
      for (const [locale, keys] of byLocale(outdated)) {
        console.log(`  ${locale}: ${keys.join(', ')}`);
      }
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
      locales: csv(values.locales),
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
      `[verbaly] exported ${counted(result.files.length, 'locale')} (${result.format}) → ${result.dir}`,
    );
    for (const file of result.files) {
      console.log(
        `  ${file.locale}: ${counted(file.total, 'message')} (${file.untranslated} ${note}) → ${file.path}`,
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
    for (const { file, from, to } of result.mapped) {
      console.log(`  ${file}: "${from}" read as ${to}`);
    }
    // a warning and exit 1, like a batch translate could not land: the file is skipped, not guessed
    for (const { file, locale, reason } of result.unmatched) {
      if (reason === 'undeclared') {
        console.warn(
          `  ${file}: "${locale}" is not one of this project's locales (${cfg.locales.join(', ')}), so nothing was imported from it`,
        );
        console.warn(
          `    fix: add ${locale} to locales in your verbaly config, or pass --locale with one of them`,
        );
      } else {
        console.warn(`  ${file}: "${locale}" is not a locale tag, so nothing was imported from it`);
        console.warn('    fix: pass --locale with the tag it stands for, like pt-BR');
      }
      process.exitCode = 1;
    }
    // a person's file clears the draft flag, unless --draft says nobody has read it yet
    const drafts = loadDrafts(cfg);
    let draftsChanged = false;
    for (const [locale, keys] of Object.entries(result.imported)) {
      if (!values['dry-run']) {
        writeCatalog(cfg, locale, catalogs[locale] ?? {});
        if (values.draft) markDrafts(drafts, locale, keys);
        else clearDrafts(drafts, locale, keys);
        draftsChanged = true;
      }
      const verb = values['dry-run'] ? 'would import' : 'imported';
      console.log(`  ${locale}: +${keys.length} ${verb}${values.draft ? ' (draft)' : ''}`);
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
        `  ${locale}: ${counted(keys.length, 'unknown key')} ignored (not in the source catalog): ${keys.join(', ')}`,
      );
    }
    if (Object.keys(result.imported).length === 0 && result.unmatched.length === 0) {
      console.log('[verbaly] nothing to import ✓');
    }
    return;
  }

  if (command === 'render') {
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
    return;
  }

  if (command === 'pseudo') {
    const catalogs = loadCatalogs(cfg);
    const locale = values.locale ?? PSEUDO_LOCALE;
    const keys = pseudoCatalogs(cfg, catalogs, locale);
    writeCatalog(cfg, locale, catalogs[locale] ?? {});
    console.log(`[verbaly] ${counted(keys.length, 'message')} pseudo-localized → ${locale}`);
    return;
  }

  console.error(`[verbaly] unknown command "${command}"\n${HELP}`);
  process.exitCode = 1;
}

// "es, pt" is how a person types a list: a space must not become part of a locale
function csv(value: string | undefined): string[] | undefined {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// a translate run is minutes of network: say what landed as it lands, never only at the end
function reportProgress(progress: TranslateProgress): void {
  const head = `  ${progress.locale} ${progress.batch}/${progress.batches}`;
  if (progress.error) console.warn(`${head}: failed (${progress.error}), continuing`);
  else console.log(`${head}: ${counted(progress.keys, 'message')}`);
}

// every compiler error already opens with [verbaly]: prefix only what does not
export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('[verbaly]') ? message : `[verbaly] ${message}`;
}

// the file is named because babel's message never is: a bare position is unactionable
function reportParseErrors(cfg: ResolvedConfig, registry: MessageRegistry): void {
  for (const { file, message } of registry.parseErrors()) {
    const rel = relative(cfg.root, file).replaceAll('\\', '/');
    console.warn(`  ${rel}: could not be parsed (${message}), its messages were not extracted`);
  }
}

// a text the code owns was edited in the catalog: say whose it is instead of erasing it quietly
function reportReplaced(
  cfg: ResolvedConfig,
  registry: MessageRegistry,
  replaced: string[],
  dryRun: boolean | undefined,
): void {
  if (replaced.length === 0) return;
  const messages = registry.messages();
  const locate = createLocator();
  const verb = dryRun ? 'would get' : 'got';
  for (const key of replaced) {
    const msg = messages.get(key);
    if (!msg) continue;
    const line = locate(msg.file, msg.start);
    const place = `${relative(cfg.root, msg.file).replaceAll('\\', '/')}${line ? `:${line}` : ''}`;
    console.warn(
      `  ${cfg.sourceLocale}: ${key} ${verb} the text written in ${place}, the code owns it: edit it there`,
    );
  }
}

// a t under another name runs fine and never translates: the scanner only reads calls named t
function reportMissed(cfg: ResolvedConfig, registry: MessageRegistry): void {
  const locate = createLocator();
  for (const { name, file, start } of registry.missed()) {
    const line = locate(file, start);
    const place = `${relative(cfg.root, file).replaceAll('\\', '/')}${line ? `:${line}` : ''}`;
    console.warn(
      `  ${place}: ${name}\`…\` is never extracted, so it stays in the source language: name it t`,
    );
  }
}

// a translator who reads {_0} cannot know what goes there
function reportPositional(cfg: ResolvedConfig, registry: MessageRegistry): void {
  for (const msg of registry.messages().values()) {
    const nameless = msg.params.filter((param) => /^_\d+$/.test(param.name));
    if (nameless.length === 0) continue;
    const file = relative(cfg.root, msg.file).replaceAll('\\', '/');
    const names = nameless.map((param) => `{${param.name}}`).join(', ');
    console.warn(
      `  ${file}: ${names} in "${msg.message}" reaches the translator without a name, put the value in a named variable first`,
    );
  }
}

// check reads the state for its warnings, and it only has to be readable when a flag gates on it
function checkState(cfg: ResolvedConfig, gating: boolean): State {
  try {
    return loadState(cfg);
  } catch (error) {
    if (gating) throw error;
    console.warn(`${formatCliError(error)}, so outdated translations are not reported`);
    return { drafts: {}, fingerprints: {} };
  }
}

function byLocale(entries: { locale: string; key: string }[]): [string, string[]][] {
  const out = new Map<string, string[]>();
  for (const { locale, key } of entries) out.set(locale, [...(out.get(locale) ?? []), key]);
  return [...out];
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
export const COMMAND_FLAGS: Record<string, string[]> = {
  init: [],
  doctor: [],
  extract: ['prune', 'dry-run', 'watch'],
  wrap: ['write'],
  migrate: ['write', 'plurals'],
  status: ['json'],
  check: ['reporter', 'drafts', 'outdated'],
  translate: ['model', 'dry-run'],
  review: ['approve', 'locale'],
  export: ['format', 'out', 'missing'],
  import: ['locale', 'overwrite', 'dry-run', 'draft'],
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
