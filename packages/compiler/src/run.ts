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
import { doctor, formatDoctorEntry, formatDoctorHealth } from './doctor';
import { exportCatalogs, importCatalogs, isMobileFormat, type ExportFormat } from './exchange';
import { collectOrigins, extractProject, shippedCatalogs } from './extract';
import { createDevReporter, formatFinding } from './findings';
import { init } from './init';
import { migrateCatalogs } from './migrate';
import { syncProject } from './project';
import { PSEUDO_LOCALE, pseudoCatalogs } from './pseudo';
import { formatRenderWarnings, renderSite } from './render';
import {
  acceptOutdated,
  clearDrafts,
  effectiveDrafts,
  loadState,
  outdatedTranslations,
  readState,
  recordTranslations,
  saveState,
  STATE_FILE,
  type State,
  type TranslationWrite,
} from './state';
import { formatStatusResult, status } from './status';
import { counted, truncate } from './text';
import {
  formatTranslateFailures,
  mergeTranslations,
  resolveProvider,
  translateCatalogs,
  type TranslateProgress,
} from './translate';
import { watchProject } from './watch';
import { wrapProject } from './wrap';

const HELP = `verbaly · i18n compiler

Usage:
  verbaly init       scaffold config + locale catalogs (detects your framework)
  verbaly doctor     diagnose the setup (config, catalogs, plugin, types, keys)
  verbaly wrap       find hardcoded JSX text and wrap it in t\`…\` (report; --write applies)
  verbaly migrate    port catalogs from another i18n library (report; --write applies)
  verbaly extract    scan sources, update catalogs and types
  verbaly typegen    write the TypeScript types only (CI: run it before tsc)
  verbaly status     translation coverage per locale, at a glance
  verbaly check      verify translations are complete (CI)
  verbaly translate  fill missing translations via a provider (default: claude)
  verbaly review [keys…]  list translations awaiting review: machine drafts and outdated ones (--approve accepts them)
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
  --approve          accept what review lists, drafts and outdated, or only the keys given (review)
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
    if (result.found) console.log(`  catalogs: ${result.found}, kept where they already are`);
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
      console.log(`[verbaly] ${formatDoctorHealth(result)} ✓`);
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

    // a watch run says each warning once, and again only after it went away and came back
    const reporter = values.watch
      ? createDevReporter(cfg.root, (line) => console.warn(`  ${line}`))
      : undefined;

    async function runExtract(): Promise<void> {
      const result = await syncProject(cfg, { prune: values.prune, dryRun });
      if (result.pruneBlocked) {
        const unread = result.registry.parseErrors().length;
        console.warn(
          `  prune skipped: an unparsed file may read any key (${counted(unread, 'file')} below), so it waits until every file parses`,
        );
      }
      for (const [locale, keys] of Object.entries(result.pruned)) {
        console.log(
          dryRun
            ? `  ${locale}: would prune ${keys.length}: ${keys.join(', ')}`
            : `  ${locale}: -${keys.length} pruned`,
        );
      }
      const total = result.registry.messages().size;
      console.log(
        `[verbaly] ${counted(total, 'message')} · locales: ${cfg.locales.join(', ')}${dryRun ? ' (dry run, nothing written)' : ''}`,
      );
      for (const [locale, keys] of Object.entries(result.added)) {
        console.log(`  ${locale}: ${dryRun ? `would add ${keys.length}` : `+${keys.length}`}`);
      }
      // news either way: an edit made in the code, or one the code undid in the catalog
      const warnings = result.findings.filter((finding) => {
        if (finding.kind !== 'replaced') return true;
        console.log(`  ${formatFinding(finding, cfg.root)}`);
        return false;
      });
      if (reporter) reporter.report('extract', warnings);
      else for (const finding of warnings) console.warn(`  ${formatFinding(finding, cfg.root)}`);
      if (result.stateProblem) {
        console.warn(
          `  ${result.stateProblem}, so drafts and outdated translations were not updated`,
        );
      }
    }

    await runExtract();
    if (values.watch) {
      watchProject(cfg, runExtract);
      console.log('[verbaly] watching for source changes (ctrl+c to stop)');
    }
    return;
  }

  if (command === 'typegen') {
    const registry = await extractProject(cfg);
    // the types describe the text that ships, the code's text wherever the code owns one
    const source = shippedCatalogs(cfg, loadCatalogs(cfg), registry)[cfg.sourceLocale] ?? {};
    const written = writeDts(cfg, source);
    if (!written) {
      console.log('[verbaly] no types written: dts is false in your verbaly config');
      return;
    }
    const where = relative(cfg.root, written.file).replaceAll('\\', '/');
    const how = written.changed ? 'written to' : 'up to date in';
    console.log(
      `[verbaly] types ${how} ${where} (${counted(Object.keys(source).length, 'message')})`,
    );
    return;
  }

  if (command === 'migrate') {
    const result = migrateCatalogs(cfg, { write: values.write, plurals: values.plurals });
    const from = result.detected.length ? result.detected.join(', ') : 'no known i18n library';
    const changes = result.braces.length + result.plurals.length;
    // said every time: a run that converts nothing must not read as one that skipped a language
    const before = result.remembered.length
      ? `, ${counted(result.remembered.length, 'language')} converted before`
      : '';
    if (changes === 0 && result.skipped.length === 0) {
      console.log(`[verbaly] catalogs need nothing (${from}${before}) ✓`);
      return;
    }
    const verb = values.write ? 'ported' : 'would port';
    const note = values.write ? '' : ' (report only, use --write to apply)';
    console.log(`[verbaly] ${verb} ${counted(changes, 'message')} from ${from}${before}${note}`);
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
    if (values.write && result.braces.length > 0) {
      console.log(
        `  ${STATE_FILE} remembers the converted languages, so a later run never reads them as i18next again`,
      );
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
    const { state, problem } = readState(cfg);
    if (problem) {
      console.warn(`[verbaly] ${problem}, so drafts and outdated translations are not counted`);
    }
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
    const outdated = values.outdated ? result.outdated : [];
    const gated = { outdatedFails: values.outdated === true };
    // the annotations carry both severities, so they print whether the gate passes or not
    if (reporter === 'github') {
      for (const line of githubCheckAnnotations(result, registry, cfg, gated)) {
        console.error(line);
      }
    } else {
      const warnings = formatCheckWarnings(result, cfg.root, gated);
      if (warnings) console.warn(`[verbaly] warnings (the gate still passes)\n${warnings}`);
    }

    const awaiting = [
      ...Object.entries(unreviewed).map(
        ([locale, keys]) => `  [${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`,
      ),
      ...byLocale(outdated).map(
        ([locale, keys]) => `  [${locale}] ${keys.length} outdated: ${keys.join(', ')}`,
      ),
    ];
    if (result.ok && awaiting.length === 0) {
      console.log('[verbaly] all translations complete ✓');
      return;
    }
    if (!result.ok) {
      const brokenCount = result.broken.filter((entry) => entry.severity === 'error').length;
      const report =
        reporter === 'github'
          ? `[verbaly] check failed: ${result.missing.length} missing, ${result.unknown.length} unknown, ${brokenCount} broken`
          : `[verbaly] check failed\n${formatCheckResult(result, cfg.root)}`;
      console.error(`${report}\n${checkNextSteps(result)}`);
    }
    // printed whether or not the gate failed too: a flag that fails the run names what it found
    if (awaiting.length > 0) {
      for (const line of awaiting) console.error(line);
      console.error(
        '[verbaly] check failed: translations awaiting review (run verbaly review, then --approve what holds)',
      );
    }
    process.exitCode = 1;
    return;
  }

  if (command === 'translate') {
    // a machine translation that lost its draft flag passes as reviewed: read the state first
    if (!values['dry-run']) loadState(cfg);
    const registry = await extractProject(cfg);
    // the provider reads the text that ships, which is the text its answer has to match
    const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
    const provider = await resolveProvider(cfg, values.model);
    const result = await translateCatalogs(cfg, catalogs, provider, {
      locales: csv(values.locales),
      batchSize: cfg.translate.batchSize,
      concurrency: cfg.translate.concurrency,
      retries: cfg.translate.retries,
      dryRun: values['dry-run'],
      // dry-run never calls the provider, so it sends no origins either
      origins: values['dry-run'] ? undefined : await collectOrigins(cfg, registry),
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

    // machine output is a draft until a human reviews it, stamped with the text it was made for
    const source = catalogs[cfg.sourceLocale] ?? {};
    const writes: TranslationWrite[] = [];
    for (const [locale, keys] of Object.entries(result.translated)) {
      const catalog = catalogs[locale] ?? {};
      const written = mergeTranslations(cfg, locale, catalog, keys);
      writes.push({
        locale,
        draft: true,
        entries: written.map((key) => ({ key, text: catalog[key]! })),
      });
      console.log(`  ${locale}: +${written.length} translated (draft)`);
      const kept = keys.length - written.length;
      if (kept > 0) {
        console.log(`  ${locale}: ${counted(kept, 'message')} kept as written while this ran`);
      }
    }
    if (writes.length > 0) recordTranslations(cfg, source, writes);
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
    const registry = await extractProject(cfg);
    const catalogs = loadCatalogs(cfg);
    // outdated against the text that ships, the one status and check count it against
    const shipped = shippedCatalogs(cfg, catalogs, registry);
    const state = loadState(cfg);
    const only = new Set(positionals.slice(1));
    const wanted = ({ locale, key }: { locale: string; key: string }): boolean =>
      (!values.locale || locale === values.locale) && (only.size === 0 || only.has(key));
    const drafts = Object.entries(effectiveDrafts(state.drafts, catalogs))
      .flatMap(([locale, keys]) => keys.map((key) => ({ locale, key })))
      .filter(wanted);
    const outdated = outdatedTranslations(cfg, shipped, state.fingerprints).filter(wanted);

    if (drafts.length === 0 && outdated.length === 0) {
      console.log('[verbaly] nothing awaiting review ✓');
      return;
    }

    if (values.approve) {
      for (const [locale, keys] of byLocale(drafts)) {
        clearDrafts(state.drafts, locale, keys);
        console.log(`  ${locale}: ${keys.length} approved`);
      }
      // a person read the old translation against the new source and kept it
      acceptOutdated(cfg, shipped, state.fingerprints, outdated);
      for (const [locale, keys] of byLocale(outdated)) {
        console.log(`  ${locale}: ${keys.length} kept for the new source text`);
      }
      saveState(cfg, state);
      // a draft can be outdated as well, and it is still one translation reviewed
      const reviewed = new Set(
        [...drafts, ...outdated].map(({ locale, key }) => `${locale}:${key}`),
      );
      console.log(`[verbaly] ${counted(reviewed.size, 'translation')} marked reviewed ✓`);
      return;
    }

    // a key alone cannot be judged: each line shows the text that ships and its translation
    const source = shipped[cfg.sourceLocale] ?? {};
    const show = (locale: string, keys: string[]): void => {
      console.log(`  ${locale}:`);
      for (const key of keys) {
        const translated = catalogs[locale]?.[key] ?? '';
        console.log(
          `    ${key}: "${truncate(source[key] ?? '', 60)}" → "${truncate(translated, 60)}"`,
        );
      }
    };
    if (drafts.length > 0) {
      console.log(
        `[verbaly] ${counted(drafts.length, 'machine translation')} awaiting review (--approve to accept)`,
      );
      for (const [locale, keys] of byLocale(drafts)) show(locale, keys);
    }
    if (outdated.length > 0) {
      console.log(
        `[verbaly] ${counted(outdated.length, 'translation')} written for an older source text (update them, or --approve keeps them)`,
      );
      for (const [locale, keys] of byLocale(outdated)) show(locale, keys);
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
    const registry = await extractProject(cfg);
    // a translator gets the text that ships, never a catalog the code has since moved past
    const shipped = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
    const result = exportCatalogs(cfg, shipped, {
      locales: csv(values.locales),
      format,
      out: values.out,
      missing: values.missing,
      // mobile formats are delivery-only: no translator reads where a text lives
      origins: isMobileFormat(format) ? undefined : await collectOrigins(cfg, registry),
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
    // the draft flags are written after the catalogs: an unreadable state writes neither
    if (!values['dry-run']) loadState(cfg);
    const registry = await extractProject(cfg);
    // checked against the text that ships, like check reads every translation
    const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
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
    // a person's file clears the draft flag unless --draft, stamped with the source it carried
    const writes: TranslationWrite[] = [];
    for (const [locale, keys] of Object.entries(result.imported)) {
      if (!values['dry-run']) {
        const catalog = catalogs[locale] ?? {};
        writeCatalog(cfg, locale, catalog);
        const seen = result.sources[locale] ?? {};
        const entries = keys.map((key) => ({ key, text: catalog[key]!, source: seen[key] }));
        writes.push({ locale, entries, draft: values.draft === true });
      }
      const verb = values['dry-run'] ? 'would import' : 'imported';
      console.log(`  ${locale}: +${keys.length} ${verb}${values.draft ? ' (draft)' : ''}`);
    }
    if (writes.length > 0) recordTranslations(cfg, catalogs[cfg.sourceLocale] ?? {}, writes);
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
    // the text that ships is the one QA has to see stretched, never a catalog the code moved past
    const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), await extractProject(cfg), {
      newKeys: false,
    });
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

// check reads the state for its warnings, and it only has to be readable when a flag gates on it
function checkState(cfg: ResolvedConfig, gating: boolean): State {
  if (gating) return loadState(cfg);
  const { state, problem } = readState(cfg);
  if (problem) console.warn(`[verbaly] ${problem}, so outdated translations are not reported`);
  return state;
}

function byLocale(entries: { locale: string; key: string }[]): [string, string[]][] {
  const out = new Map<string, string[]>();
  for (const { locale, key } of entries) {
    const keys = out.get(locale);
    if (keys) keys.push(key);
    else out.set(locale, [key]);
  }
  return [...out];
}

// flags shared by every command (config overrides)
const COMMON_FLAGS = new Set(['root', 'dir', 'source', 'locales', 'help']);
export const COMMAND_FLAGS: Record<string, string[]> = {
  init: [],
  doctor: [],
  extract: ['prune', 'dry-run', 'watch'],
  typegen: [],
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
