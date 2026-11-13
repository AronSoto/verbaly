import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flatten } from 'verbaly';
import { auditBundle, formatBundleIssue } from '../emit/bundle';
import { badLeaf, emptyCatalog, isTree, parseTree, type Catalog } from '../catalog/catalog';
import { check } from '../gate/check';
import { DTS_HEADER, generateDts, projectDtsOptions } from '../emit/codegen';
import { findConfigFile, type ResolvedConfig } from '../config/config';
import type { MessageRegistry } from '../scan/registry';
import { extractProject } from '../scan/extract';
import { shippedCatalogs } from '../scan/sync';
import { sourcePlace } from '../gate/findings';
import {
  CLI_INSTALL_FIX,
  cliReachable,
  detectHost,
  installCommand,
  readDependencies,
  WIRING_PACKAGES,
} from '../config/host';
import { filesOutsideInclude } from '../scan/scope';
import { typesIncluded } from '../config/tsconfig';
import { counted } from '../util/text';
import { isLocaleTag, suggestTag } from '../util/tag';
import { effectiveDrafts } from '../catalog/state';
import { readState, STATE_FILE, type State } from '../catalog/lock';
import { escapedSyntax, inlineBlock, shownSlice } from '../gate/validate';
import { relativePath } from '../util/path';

export interface DoctorEntry {
  level: 'ok' | 'warn' | 'error';
  check: string;
  message: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean; // no error-level entries (warns allowed)
  entries: DoctorEntry[];
}

const PREVIEW = 5; // keys shown before "…"

// a mode nobody wrote down was inferred, and doctor says which of the two it is reading
function readRoutingChoice(root: string, configFile: string): boolean {
  try {
    return /\brouting["']?\s*[:=]/.test(readFileSync(join(root, configFile), 'utf8'));
  } catch {
    return false;
  }
}

// the mode @verbaly/astro takes from Astro's i18n, read like the config above: no Astro to run
function readAstroRouting(
  root: string,
  source: string,
): { mode: ResolvedConfig['routing']; file: string } | undefined {
  // Astro's own lookup order: the first file it would load is the one it reads
  for (const file of [
    'astro.config.mjs',
    'astro.config.js',
    'astro.config.ts',
    'astro.config.mts',
  ]) {
    let text: string;
    try {
      text = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (!/\bi18n\s*:/.test(text) || /\brouting\s*:\s*['"]manual['"]/.test(text)) return undefined;
    if (/\bprefixDefaultLocale\s*:\s*true\b/.test(text)) return { mode: 'prefix-all', file };
    // another language at the root is a url no Verbaly mode writes: the integration keeps one
    const atRoot = /\bdefaultLocale\s*:\s*['"]([^'"]+)['"]/.exec(text)?.[1];
    return atRoot && atRoot !== source ? undefined : { mode: 'prefix-except-source', file };
  }
  return undefined;
}

const ROUTING_SAYS: Record<ResolvedConfig['routing'], string> = {
  'prefix-except-source': 'the source locale has no prefix, every other locale does',
  'prefix-all': 'every locale has a prefix, the source included',
  'no-prefix': 'the language is not in the url, one address serves every locale',
};

const ICON = { ok: '✓', warn: '⚠', error: '✗' } as const;

// one definition of a doctor line: the cli routes it by level, the mcp tool joins the block
export function formatDoctorEntry(entry: DoctorEntry): string {
  const head = `  ${ICON[entry.level]} ${entry.check}: ${entry.message}`;
  return entry.fix
    ? `${head}
      fix: ${entry.fix}`
    : head;
}

// the verdict under the entries: healthy said after a warning read as if nothing needed a look
export function formatDoctorHealth(result: DoctorResult): string {
  if (!result.ok) return 'problems found';
  const warnings = result.entries.filter((entry) => entry.level === 'warn').length;
  return warnings > 0
    ? `setup works, with ${counted(warnings, 'warning')} to read`
    : 'setup looks healthy';
}

type Messages = ReturnType<MessageRegistry['messages']>;

// every name an entry carries, besides `locale <id>`: Studio gives each one a title
type CheckName =
  | 'config'
  | 'cli'
  | 'catalogs'
  | 'locales'
  | 'source'
  | 'routing'
  | 'plugin'
  | 'sources'
  | 'types'
  | 'imports'
  | 'messages'
  | 'orphans'
  | 'bundle'
  | 'state'
  | 'drafts'
  | 'keys'
  | 'translations'
  | 'extras'
  | 'source texts'
  | 'outdated'
  | `locale ${string}`;

// what every zone writes into: the entries, in the order they are printed
interface Report {
  entries: DoctorEntry[];
  ok: (name: CheckName, message: string) => void;
  warn: (name: CheckName, message: string, fix: string) => void;
  error: (name: CheckName, message: string, fix: string) => void;
  rel: (path: string) => string;
}

function createReport(cfg: ResolvedConfig): Report {
  const entries: DoctorEntry[] = [];
  return {
    entries,
    ok: (name, message) => void entries.push({ level: 'ok', check: name, message }),
    warn: (name, message, fix) => void entries.push({ level: 'warn', check: name, message, fix }),
    error: (name, message, fix) => void entries.push({ level: 'error', check: name, message, fix }),
    rel: (path) => relativePath(cfg.root, path),
  };
}

// the index: each zone reports in this order, and what one read is handed to the next
export async function doctor(cfg: ResolvedConfig): Promise<DoctorResult> {
  const report = createReport(cfg);
  const { ok } = report;
  const configFile = checkSetup(report, cfg);
  const { catalogs, catalogsHealthy, source } = checkCatalogs(report, cfg);
  checkRouting(report, cfg, configFile);
  const host = checkPlugin(report, cfg);

  // with include: [] no code is read, so orphans and types cannot be claimed here
  const scanning = cfg.include.length > 0;
  if (!scanning) {
    ok('sources', 'source scanning is off (include: []), the catalogs are the source of truth');
  }

  const registry = await extractProject(cfg);
  const messages = registry.messages();

  if (source && scanning) checkTypes(report, cfg, host, catalogs, registry, source);
  if (scanning) await checkSources(report, cfg, registry, messages);
  if (source && scanning) checkOrphans(report, source, registry, messages);
  if (catalogsHealthy) checkBundle(report, cfg, catalogs, registry);
  const state = checkState(report, cfg, catalogs, catalogsHealthy);
  if (catalogsHealthy) mirrorGate(report, cfg, catalogs, registry, state, scanning);

  return { ok: report.entries.every((entry) => entry.level !== 'error'), entries: report.entries };
}

function checkSetup(report: Report, cfg: ResolvedConfig): string | undefined {
  const { ok, warn } = report;
  const configFile = findConfigFile(cfg.root);
  if (configFile) ok('config', `${configFile} found`);
  else warn('config', 'no config file, running on defaults', 'run `npx verbaly init`');

  // the build works without it: what breaks is every command we tell people to run
  if (cliReachable(cfg.root)) ok('cli', 'the verbaly command is available in this project');
  else warn('cli', 'the verbaly command is not linked in node_modules/.bin', CLI_INSTALL_FIX);
  return configFile;
}

function checkCatalogs(
  report: Report,
  cfg: ResolvedConfig,
): { catalogs: Record<string, Catalog>; catalogsHealthy: boolean; source: Catalog | undefined } {
  const { ok, warn, error, rel } = report;
  const catalogs = emptyCatalog<Catalog>();
  let catalogsHealthy = true;
  if (!existsSync(cfg.dir)) {
    catalogsHealthy = false;
    error(
      'catalogs',
      `catalogs directory ${rel(cfg.dir)}/ does not exist`,
      'run `npx verbaly init` to scaffold it',
    );
  } else {
    for (const locale of cfg.locales) {
      const file = join(cfg.dir, `${locale}.json`);
      if (!existsSync(file)) {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is missing`,
          'run `npx verbaly extract` to create it',
        );
        continue;
      }
      // the same reader the gate uses, so a BOM the build accepts is never an error here
      const parsed = parseTree(readFileSync(file, 'utf8'));
      if (parsed === undefined) {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is not valid JSON`,
          'repair the file (or delete it and run `npx verbaly extract`)',
        );
        continue;
      }
      if (!isTree(parsed)) {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is not a JSON object of messages`,
          'a catalog is an object of texts (groups of text are fine): fix the file',
        );
        continue;
      }
      // nested groups are a real shape: only a leaf that is not text is broken
      const bad = badLeaf(parsed);
      if (bad) {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} has a non-string value at "${bad}"`,
          'catalog values are text (groups of text are fine); fix the value',
        );
      } else {
        catalogs[locale] = flatten(parsed);
      }
    }
    if (catalogsHealthy) {
      const how = cfg.localesDeclared ? '' : ', no locales set, so the catalog files decide';
      ok(
        'catalogs',
        `${counted(cfg.locales.length, 'locale')} (${cfg.locales.join(', ')}) in ${rel(cfg.dir)}/${how}`,
      );
    }
  }

  // it builds and the runtime falls back with a warn, so this is a warn too, rename in hand
  for (const locale of cfg.locales) {
    if (isLocaleTag(locale)) continue;
    const near = suggestTag(locale);
    const file = rel(join(cfg.dir, `${locale}.json`));
    warn(
      'locales',
      `"${locale}" is not a locale tag, so numbers, dates and plurals in it format in a fallback`,
      near
        ? `rename it to ${near}: the file ${file} and your config`
        : `name it with a language tag like es or pt-BR, in ${file} and in your config`,
    );
  }

  const source = catalogs[cfg.sourceLocale];
  if (source && Object.keys(source).length === 0) {
    warn(
      'source',
      `source catalog ${cfg.sourceLocale}.json is empty`,
      'write your first t`…` message and run `npx verbaly extract`',
    );
  }
  return { catalogs, catalogsHealthy, source };
}

function checkRouting(report: Report, cfg: ResolvedConfig, configFile: string | undefined): void {
  const { ok, warn } = report;
  const mirrors = Object.keys(cfg.render).length > 0;
  if (cfg.routing === 'no-prefix' && mirrors) {
    warn(
      'routing',
      'routing is "no-prefix" but a render section is configured, and render writes one url tree per locale',
      'drop the render section, or set routing to "prefix-except-source" so the helpers agree with the urls',
    );
  } else if (cfg.routing === 'prefix-all' && mirrors) {
    // render leaves the source tree at the root, so a helper that prefixes it points at no page
    warn(
      'routing',
      `routing is "prefix-all" but render keeps ${cfg.sourceLocale} at the root, so its links point at a /${cfg.sourceLocale}/ tree nobody wrote`,
      'set routing to "prefix-except-source", the url tree render writes',
    );
  } else {
    const named = configFile ? readRoutingChoice(cfg.root, configFile) : false;
    // the rule @verbaly/astro applies: Astro's i18n replaces no-prefix, a prefix mode stays
    const replaced = cfg.host === 'astro' && cfg.routing === 'no-prefix';
    const astro = replaced ? readAstroRouting(cfg.root, cfg.sourceLocale) : undefined;
    if (astro && named) {
      warn(
        'routing',
        `routing is "no-prefix" in ${configFile}, but @verbaly/astro uses ${astro.mode}: Astro's i18n in ${astro.file} puts the language in the url`,
        `remove routing from ${configFile}, or remove i18n from ${astro.file}`,
      );
    } else if (astro) {
      const how = ` (from Astro's i18n in ${astro.file}, which @verbaly/astro follows)`;
      ok('routing', `${astro.mode}${how}: ${ROUTING_SAYS[astro.mode]}`);
    } else {
      const how = named ? '' : ' (from your setup, no routing set)';
      ok('routing', `${cfg.routing}${how}: ${ROUTING_SAYS[cfg.routing]}`);
    }
  }
}

function checkPlugin(report: Report, cfg: ResolvedConfig): ReturnType<typeof detectHost> {
  const { ok, warn } = report;
  const deps = readDependencies(cfg.root);
  const host = detectHost(cfg.root);
  const installed = WIRING_PACKAGES.find((pkg) => deps[pkg]);
  if (!host) {
    ok('plugin', 'no framework or bundler detected, the CLI flow (extract/check) applies');
  } else if (installed) {
    ok('plugin', `${installed} installed for ${host.name}`);
  } else {
    warn(
      'plugin',
      `${host.name} detected but ${host.pkg} is not installed`,
      `${installCommand(cfg.root, host.install)}, then ${host.wire}`,
    );
  }
  return host;
}

function checkTypes(
  report: Report,
  cfg: ResolvedConfig,
  host: ReturnType<typeof detectHost>,
  catalogs: Record<string, Catalog>,
  registry: MessageRegistry,
  source: Catalog,
): void {
  const { ok, warn, rel } = report;
  if (cfg.dts === false) return;
  const dtsPath = cfg.dts;
  const shown = rel(dtsPath);
  // a framework slot is linked from the framework's own types, which only its command writes
  const regenerate =
    host?.name === 'astro'
      ? 'run `npx astro sync`, which writes the types and links them'
      : host?.name === 'nuxt'
        ? 'run `npx nuxi prepare`, which writes the types and links them'
        : 'run `npx verbaly typegen`';
  // what typegen and a build write: the text that ships, a key only the code has included
  const shipped = shippedCatalogs(cfg, catalogs, registry)[cfg.sourceLocale] ?? source;
  const expected = generateDts(shipped, projectDtsOptions(cfg));
  if (!existsSync(dtsPath)) {
    warn('types', `${shown} has not been generated`, regenerate);
  } else if (readFileSync(dtsPath, 'utf8').replace(/\r\n/g, '\n') !== expected) {
    warn('types', `${shown} is stale`, 'run `npx verbaly typegen`');
  } else {
    ok('types', `${shown} is up to date`);
  }
  // .verbaly/ is a dot folder: TypeScript reads it only if tsconfig names the file
  if (dtsPath.startsWith(join(cfg.root, '.verbaly'))) {
    const state = typesIncluded(cfg.root, dtsPath);
    if (state === 'missing' || state === 'unreadable') {
      warn(
        'types',
        state === 'missing'
          ? `tsconfig.json does not include ${shown}, so TypeScript never reads the types`
          : `tsconfig.json could not be read, so it may not include ${shown}`,
        `run \`npx verbaly typegen\`, which adds the line, or add "${shown}" to include`,
      );
    }
  }
  // the root file and the one in its new place declare the same module twice
  const old = join(cfg.root, 'verbaly.d.ts');
  if (dtsPath !== old && existsSync(old) && readFileSync(old, 'utf8').startsWith(DTS_HEADER)) {
    warn(
      'types',
      `the verbaly.d.ts Verbaly wrote at the root is still there next to ${shown}, and they declare the same module twice`,
      'run `npx verbaly typegen`, which removes it',
    );
  }
}

async function checkSources(
  report: Report,
  cfg: ResolvedConfig,
  registry: MessageRegistry,
  messages: Messages,
): Promise<void> {
  const { warn, error, rel } = report;
  // a warn, not an error: decorators or a dialect babel does not read still build in the project
  const unreadable = registry.parseErrors();
  if (unreadable.length > 0) {
    const first = unreadable[0]!;
    warn(
      'sources',
      `could not parse ${counted(unreadable.length, 'file')}, so the messages inside are not extracted (${rel(first.file)}: ${first.message})`,
      'fix the syntax error, or exclude the file in your config if it is not source',
    );
  }
  // a file the build reads and extract never will: its texts show the source language everywhere
  const outside = await filesOutsideInclude(cfg);
  if (outside.length > 0) {
    const files = outside.map((entry) => rel(entry.file));
    const patterns = [...new Set(outside.map((entry) => `"${entry.pattern}"`))];
    warn(
      'sources',
      `t\`…\` is written in ${counted(outside.length, 'file')} outside include, and those texts are never extracted or translated (${preview(files)})`,
      `add ${patterns.join(' and ')} to include in your verbaly config, or the files to exclude if they are not app code`,
    );
  }
  const stray = registry.strayImports();
  if (stray.length > 0) {
    const files = [...new Set(stray.map((entry) => rel(entry.file)))];
    error(
      'imports',
      `t is imported from a verbaly package, which never exports it, in ${counted(files.length, 'file')} (${preview(files)})`,
      't comes from your instance (React: const t = useT()) or from verbaly/app',
    );
  }
  // a t under another name reads fine at runtime, and its texts stay in the source language
  const missed = registry.missed();
  if (missed.length > 0) {
    const first = missed[0]!;
    warn(
      'sources',
      `a t under another name keeps ${counted(missed.length, 'text')} out of extraction (${sourcePlace(first, cfg.root)}: ${first.name}\`…\`)`,
      'name it t (const t = useT()), the only name verbaly reads, or use t(key) with the key in the catalog',
    );
  }
  // a translator who sees {_0} cannot know what goes there
  const positional = [...messages.values()].filter((msg) =>
    msg.params.some((param) => /^_\d+$/.test(param.name)),
  );
  if (positional.length > 0) {
    const first = positional[0]!;
    warn(
      'messages',
      `a translator gets a nameless value like {_0} in ${counted(positional.length, 'message')} (${sourcePlace(first, cfg.root)}: "${first.message}")`,
      'put the value in a named variable first (const date = formatDate(d)), so the message says {date}',
    );
  }
  const escaped = [...messages.values()]
    .map((msg) => ({ file: rel(msg.file), slice: escapedSyntax(msg.message) }))
    .filter((entry) => entry.slice !== undefined);
  if (escaped.length > 0) {
    warn(
      'messages',
      `a block ships as literal text in ${counted(escaped.length, 'extracted message')} (${escaped[0]!.file}: ${shownSlice(escaped[0]!.slice!)})`,
      `in a tagged template, write ${inlineBlock(escaped[0]!.slice!)}`,
    );
  }
}

function checkOrphans(
  report: Report,
  source: Catalog,
  registry: MessageRegistry,
  extracted: Messages,
): void {
  const { ok, warn } = report;
  const used = registry.usedKeys();
  const orphans = Object.keys(source).filter((key) => !extracted.has(key) && !used.has(key));
  // a file that did not parse may be the one reading them, and prune waits until it does
  const unread = registry.parseErrors().length > 0;
  if (orphans.length > 0) {
    warn(
      'orphans',
      `${counted(orphans.length, 'catalog key')} no longer referenced in code (${preview(orphans)})`,
      unread
        ? 'fix the files that do not parse first, they may use these, and `npx verbaly extract --prune` leaves every key alone until then'
        : 'run `npx verbaly extract --prune` to drop them',
    );
  } else {
    ok('orphans', 'no orphan keys');
  }
}

function checkBundle(
  report: Report,
  cfg: ResolvedConfig,
  catalogs: Record<string, Catalog>,
  registry: MessageRegistry,
): void {
  const { ok, warn } = report;
  const excluded = cfg.bundle.exclude ?? [];
  if (excluded.length === 0) return;
  const issues = auditBundle(cfg, catalogs, registry);
  for (const issue of issues) warn('bundle', formatBundleIssue(issue), issue.fix);
  if (issues.length === 0) {
    ok(
      'bundle',
      `${counted(excluded.length, 'group')} kept out of the client (${preview(excluded)})`,
    );
  }
}

function checkState(
  report: Report,
  cfg: ResolvedConfig,
  catalogs: Record<string, Catalog>,
  catalogsHealthy: boolean,
): State {
  const { warn } = report;
  // the state only feeds warnings, so a broken lock is reported here and never stops a build
  const { state, problem, conflict } = readState(cfg);
  if (problem) {
    warn(
      'state',
      problem,
      conflict
        ? 'resolve it by hand, keeping the entries of both sides: taking one side approves the drafts of the other'
        : `restore ${STATE_FILE} from git: deleting it would mark every machine draft as reviewed`,
    );
  } else if (conflict) {
    warn(
      'state',
      `${STATE_FILE} has a merge conflict, and both sides were read`,
      'run `npx verbaly extract`, which writes both sides into it, then commit it',
    );
  }
  if (catalogsHealthy) {
    const stale = Object.entries(state.drafts).flatMap(([locale, keys]) => {
      const live = new Set(effectiveDrafts({ [locale]: keys }, catalogs)[locale] ?? []);
      return keys.filter((key) => !live.has(key)).map((key) => `${locale}: ${key}`);
    });
    if (stale.length > 0) {
      warn(
        'drafts',
        `${STATE_FILE} lists ${counted(stale.length, 'draft')} whose translation is gone (${preview(stale)})`,
        'run `npx verbaly extract`, which drops them',
      );
    }
  }
  return state;
}

// the mirror of the gate: what check fails is an error here, except a missing translation
function mirrorGate(
  report: Report,
  cfg: ResolvedConfig,
  catalogs: Record<string, Catalog>,
  registry: MessageRegistry,
  state: State,
  scanning: boolean,
): void {
  const { ok, warn, error } = report;
  const result = check(cfg, catalogs, registry, state.fingerprints);
  if (result.unknown.length > 0) {
    error(
      'keys',
      `${counted(result.unknown.length, 'unknown key')} used in code (${preview(result.unknown.map((u) => u.key))})`,
      'fix the key or add it to the catalogs (`npx verbaly check` for details)',
    );
  }
  if (result.missing.length > 0) {
    const locales = [...new Set(result.missing.map((m) => m.locale))];
    warn(
      'translations',
      `${counted(result.missing.length, 'missing translation')} (${locales.join(', ')})`,
      'run `npx verbaly translate` or fill the catalogs (`npx verbaly check` for details)',
    );
  }
  // the gate fails on these, so doctor cannot keep calling the setup healthy
  const broken = result.broken.filter((entry) => entry.severity === 'error');
  if (broken.length > 0) {
    const locales = [...new Set(broken.map((b) => b.locale))];
    error(
      'translations',
      `${counted(broken.length, 'broken translation')} (${locales.join(', ')}): present but not rendering what the source renders`,
      'run `npx verbaly check` to read what each one lost',
    );
  }
  if (result.extra.length > 0) {
    const shown = result.extra.map((entry) => `${entry.locale}: ${entry.key}`);
    warn(
      'extras',
      `a translation has ${counted(result.extra.length, 'key')} the source catalog does not (${preview(shown)})`,
      scanning
        ? 'add them to the source catalog if your code uses them, or run `npx verbaly extract --prune` to drop the rest'
        : 'add them to the source catalog if your code uses them, or delete them from the translations',
    );
  }
  const warnings = result.broken.filter((entry) => entry.severity === 'warning');
  if (warnings.length > 0) {
    warn(
      'translations',
      `${counted(warnings.length, 'structural warning')} (plural forms a language asks for)`,
      'run `npx verbaly check` to read them, they never fail the build',
    );
  }
  if (result.collisions.length > 0) {
    const first = result.collisions[0]!;
    error(
      'keys',
      `${counted(result.collisions.length, 'key')} written with more than one text, and every place shows the first (${first.key}: ${first.sites.map((at) => sourcePlace(at, cfg.root)).join(', ')})`,
      'give each text its own key (`npx verbaly check` lists every place)',
    );
  }
  if (result.divergent.length > 0) {
    const first = result.divergent[0]!;
    warn(
      'source texts',
      `the code and ${cfg.sourceLocale}.json disagree on ${counted(result.divergent.length, 'text')}, and the code's text ships (${first.key}, ${sourcePlace(first.code, cfg.root)})`,
      'edit those texts in the code; `npx verbaly extract` writes them into the catalog',
    );
  }
  if (result.outdated.length > 0) {
    const shown = result.outdated.map((entry) => `${entry.locale}: ${entry.key}`);
    warn(
      'outdated',
      `${counted(result.outdated.length, 'translation')} written for an older source text (${preview(shown)})`,
      'update them, or keep them with `npx verbaly review --approve`',
    );
  }
  if (result.ok) ok('translations', 'all translations complete');
}

function preview(keys: string[]): string {
  const head = keys.slice(0, PREVIEW).join(', ');
  return keys.length > PREVIEW ? `${head}, …` : head;
}
