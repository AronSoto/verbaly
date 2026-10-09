import { relative } from 'node:path';
import picomatch from 'picomatch';
import { auditBundle, clientCatalogs, formatBundleIssue } from './bundle';
import {
  emptyCatalog,
  loadCatalogs,
  needsIcu,
  needsRelative,
  type Catalog,
  type Catalogs,
} from './catalog';
import {
  check,
  checkNextSteps,
  formatBuildReport,
  formatCheckResult,
  gatePasses,
  warningCount,
  type CheckResult,
} from './check';
import { VIRTUAL_ID, generateLocaleModule, generateRuntimeModule } from './codegen';
import type { ResolvedConfig, VerbalyConfig } from './config';
import { cliReachable } from './init';
import type { MessageRegistry } from './registry';
import { analyzeFile } from './sfc';
import { readState, type Fingerprints } from './state';
import { counted } from './text';
import { transformCode, type TransformResult } from './transform';
import { warnOnce, warnParseError } from './warn';

export interface PluginOptions extends VerbalyConfig {
  // true stops the build on whatever fails check; by default the build reports and goes on
  failOnMissing?: boolean;
}

export const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;
export const LOCALE_MODULE_PREFIX = `${RESOLVED_VIRTUAL_ID}/locale/`;
export const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro)$/;

export function resolveVirtualId(id: string): string | undefined {
  if (id === VIRTUAL_ID || id.startsWith(`${VIRTUAL_ID}/`)) return '\0' + id;
  return undefined;
}

export function loadVirtualModule(
  id: string,
  cfg: ResolvedConfig,
  catalogs: Catalogs,
): string | undefined {
  // filtered before the detectors run: a group that leaves the bundle takes its parsers with it
  const client = clientCatalogs(cfg, catalogs);
  if (id === RESOLVED_VIRTUAL_ID) {
    return generateRuntimeModule(cfg, {
      icu: cfg.icu ?? needsIcu(client),
      relative: cfg.relative ?? needsRelative(client),
      inlineCatalog: cfg.render.inlineCatalog === true,
    });
  }
  if (id.startsWith(LOCALE_MODULE_PREFIX)) {
    return generateLocaleModule(client[id.slice(LOCALE_MODULE_PREFIX.length)] ?? {});
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

// analyze + register + rewrite: the per-file transform every bundler plugin runs
export function transformSource(
  code: string,
  id: string,
  registry: MessageRegistry,
): { messages: Catalog; result: TransformResult | null } {
  const analysis = analyzeFile(code, id);
  registry.update(id, analysis);
  if (analysis.parseError) warnParseError(id, analysis.parseError);
  // key → text for live extraction; first wins, mirroring the registry's collision rule
  const messages = emptyCatalog();
  for (const msg of analysis.tagged) messages[msg.key] ??= msg.message;
  return { messages, result: transformCode(code, id, analysis) ?? null };
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
    warnOnce(
      `check has ${counted(warnings, 'warning')}, and the build still passes: run \`npx verbaly check\` to read them`,
      'gate:warnings',
    );
  }
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
  };
  reported.set(cfg.root, now);
  const lines = formatBuildReport(report, cfg.sourceLocale, cfg.root);
  if (lines.length === 0) return;
  const steps = checkNextSteps({ ...found, ...report }, cliReachable(cfg.root));
  const block = [
    ...lines.map((line) => (line.startsWith('  ') ? line : `[verbaly] ${line}`)),
    '[verbaly] to fix them:',
    ...steps.split('\n').map((step) => `  ${step}`),
    '[verbaly] `npx verbaly check` lists every one, and in your CI it stops a release on them',
  ];
  console.warn(block.join('\n'));
}

// the state only feeds a warning, so a sidecar nobody can parse must not be what stops a build
function buildFingerprints(cfg: ResolvedConfig): Fingerprints {
  const { state, problem } = readState(cfg);
  if (problem) warnOnce(`${problem}, so outdated translations are not reported`, 'gate:state');
  return state.fingerprints;
}
