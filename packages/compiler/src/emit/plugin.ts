import { relative } from 'node:path';
import picomatch from 'picomatch';
import { auditBundle, clientCatalogs, formatBundleIssue } from './bundle';
import {
  emptyCatalog,
  loadCatalogs,
  needsIcu,
  needsRelative,
  own,
  type Catalog,
  type Catalogs,
} from '../catalog/catalog';
import {
  check,
  checkNextSteps,
  formatBuildReport,
  formatCheckResult,
  gatePasses,
  warningCount,
  type CheckResult,
} from '../gate/check';
import {
  generateLocaleModule,
  generateRuntimeModule,
  writeDts,
  type RuntimeModuleOptions,
} from './codegen';
import { pluginOnlyOptions, type ResolvedConfig, type VerbalyConfig } from '../config/config';
import { scannedAnalysis } from '../scan/extract';
import { LOCALE_IMPORT, VIRTUAL_ID, isAppModule } from '../util/ids';
import { cliReachable } from '../config/host';
import type { MessageRegistry } from '../scan/registry';
import { analyzeFile } from '../scan/sfc';
import { readState, type Fingerprints } from '../catalog/state';
import { counted } from '../util/text';
import { transformCode, type TransformResult } from '../scan/transform';
import { warnOnce, warnParseError } from '../util/warn';

export interface PluginOptions extends VerbalyConfig {
  // true stops the build on whatever fails check; by default the build reports and goes on
  failOnMissing?: boolean;
  // false: dev applies the code's texts in memory, as a build does, and verbaly extract writes them
  liveExtraction?: boolean;
}

export const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
export const LOCALE_MODULE_PREFIX = `${RESOLVED_VIRTUAL_ID}/locale/`;
export const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro)$/;

export function resolveVirtualId(id: string): string | undefined {
  // one resolved id for both names, so verbaly/app and virtual:verbaly share one instance
  if (isAppModule(id)) return RESOLVED_VIRTUAL_ID;
  if (id.startsWith(LOCALE_IMPORT)) return LOCALE_MODULE_PREFIX + id.slice(LOCALE_IMPORT.length);
  if (id.startsWith(`${VIRTUAL_ID}/`)) return '\0' + id;
  return undefined;
}

export interface ClientModules {
  // the module every import of verbaly/app gets
  runtime(): string;
  // one language's messages, as the browser receives them
  locale(locale: string): string;
}

// what the browser receives, decided in one place for a virtual module and for files on disk
export function clientModules(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  options: Pick<RuntimeModuleOptions, 'localeImport' | 'extraExports'> = {},
): ClientModules {
  // filtered before the detectors run: a group that leaves the bundle takes its parsers with it
  const client = clientCatalogs(cfg, catalogs);
  return {
    runtime: () =>
      generateRuntimeModule(cfg, {
        ...options,
        icu: cfg.icu ?? needsIcu(client),
        relative: cfg.relative ?? needsRelative(client),
        inlineCatalog: cfg.render.inlineCatalog === true,
      }),
    // a request names the locale, and a name every object inherits is no catalog
    locale: (locale) => generateLocaleModule(own(client, locale) ?? {}),
  };
}

export function loadVirtualModule(
  id: string,
  cfg: ResolvedConfig,
  catalogs: Catalogs,
): string | undefined {
  if (id === RESOLVED_VIRTUAL_ID) return clientModules(cfg, catalogs).runtime();
  if (id.startsWith(LOCALE_MODULE_PREFIX)) {
    return clientModules(cfg, catalogs).locale(id.slice(LOCALE_MODULE_PREFIX.length));
  }
  return undefined;
}

export function isTransformTarget(id: string): boolean {
  return SOURCE_FILE_RE.test(id) && !id.includes('node_modules') && !id.startsWith('\0');
}

export function createSourceFilter(cfg: ResolvedConfig): (id: string) => boolean {
  if (cfg.include.length === 0) return () => false;
  const matches = picomatch(cfg.include, { ignore: cfg.exclude });
  return (id) => {
    const rel = relative(cfg.root, id).replaceAll('\\', '/');
    return !rel.startsWith('..') && matches(rel);
  };
}

// analyze, register, rewrite and load verbaly/app for adapters; a build's scan skips a reparse
export function transformSource(
  code: string,
  id: string,
  registry: MessageRegistry,
  scan?: MessageRegistry,
): { messages: Catalog; result: TransformResult | null } {
  const analysis = (scan && scannedAnalysis(scan, id, code)) ?? analyzeFile(code, id);
  registry.update(id, analysis);
  if (analysis.parseError) warnParseError(id, analysis.parseError);
  // key → text for live extraction; first wins, mirroring the registry's collision rule
  const messages = emptyCatalog();
  for (const msg of analysis.tagged) messages[msg.key] ??= msg.message;
  return { messages, result: transformCode(code, id, analysis, { appImport: true }) ?? null };
}

// a build writes the types of the text it ships, as next build does, so a clone typechecks after it
export function writeBuildTypes(cfg: ResolvedConfig, catalogs: Catalogs): void {
  try {
    writeDts(cfg, catalogs[cfg.sourceLocale] ?? {});
  } catch (error) {
    // only the disk is forgiven: a bug in the types themselves must still surface
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code !== 'string') throw error;
    // types never stop a build: a read-only checkout still ships, and typegen writes them later
    const file = cfg.dts === false ? '' : relative(cfg.root, cfg.dts).replaceAll('\\', '/');
    warnOnce(
      `could not write the types to ${file} (${code}): run \`npx verbaly typegen\` where the project can be written`,
      `types:${cfg.root}`,
    );
  }
}

// a text never stops a build unless the project asks: check in CI is the strict gate
export function runBuildGate(
  cfg: ResolvedConfig,
  registry: MessageRegistry,
  failOnMissing?: boolean,
): void {
  const catalogs = loadCatalogs(cfg);
  // warns, never blocks: an excluded group that a page needs is a mistake the build cannot prove
  for (const issue of auditBundle(cfg, catalogs, registry)) {
    warnOnce(`${formatBundleIssue(issue)}\n  fix: ${issue.fix}`, `bundle:${issue.prefix}`);
  }
  const found = check(cfg, catalogs, registry, buildFingerprints(cfg));
  if (failOnMissing === true && !gatePasses(found)) {
    throw new Error(
      `[verbaly] build blocked\n${formatCheckResult(found, cfg.root)}\n${checkNextSteps(found, cliReachable(cfg.root))}`,
    );
  }
  reportGate(cfg, found);
  // a warning never stops a build, so the build says they exist in one line and check reads them
  const warnings = warningCount(found);
  if (warnings > 0) {
    const once = onceMoved(cfg.root);
    const read = once
      ? `\`npx verbaly check\` reads them${once}`
      : 'run `npx verbaly check` to read them';
    warnOnce(
      `check has ${counted(warnings, 'warning')}, and the build still passes: ${read}`,
      'gate:warnings',
    );
  }
}

// check reads verbaly.config alone: while the plugin sets more, pointing at it would lead nowhere
function onceMoved(root: string): string {
  const moved = pluginOnlyOptions(root);
  if (!moved) return '';
  return ` once ${moved} ${moved.includes(' and ') ? 'move' : 'moves'} to verbaly.config`;
}

// per project, what the last report said: a watch rebuilds, and client and server builds share it
const reported = new Map<string, Set<string>>();

// each failure once while it lasts, and again only after it went away and came back
function reportGate(cfg: ResolvedConfig, found: CheckResult): void {
  const before = reported.get(cfg.root) ?? new Set<string>();
  const now = new Set<string>();
  const fresh = <T>(entries: T[], id: (entry: T) => string): T[] =>
    entries.filter((entry) => {
      const key = id(entry);
      now.add(key);
      return !before.has(key);
    });
  const report = {
    broken: fresh(
      found.broken.filter((entry) => entry.severity === 'error'),
      (entry) => `broken:${entry.locale}:${entry.key}:${entry.issue}`,
    ),
    missing: fresh(found.missing, (entry) => `missing:${entry.locale}:${entry.key}`),
    unknown: fresh(found.unknown, (entry) => `unknown:${entry.key}`),
    collisions: fresh(found.collisions, (entry) => `collision:${entry.key}`),
  };
  reported.set(cfg.root, now);
  const lines = formatBuildReport(report, cfg.sourceLocale, cfg.root);
  if (lines.length === 0) return;
  const steps = checkNextSteps({ ...found, ...report }, cliReachable(cfg.root));
  const block = [
    ...lines.map((line) => (line.startsWith('  ') ? line : `[verbaly] ${line}`)),
    '[verbaly] to fix them:',
    ...steps.split('\n').map((step) => `  ${step}`),
    `[verbaly] \`npx verbaly check\` lists every one${onceMoved(cfg.root)}, and in your CI it stops a release on them`,
  ];
  console.warn(block.join('\n'));
}

// the state only feeds a warning, so a lock nobody can parse must not be what stops a build
function buildFingerprints(cfg: ResolvedConfig): Fingerprints {
  const { state, problem } = readState(cfg);
  if (problem) warnOnce(`${problem}, so outdated translations are not reported`, 'gate:state');
  return state.fingerprints;
}
