import { relative } from 'node:path';
import picomatch from 'picomatch';
import type { Analysis } from './analyze';
import { loadCatalogs, type Catalogs } from './catalog';
import { check, checkNextSteps, formatCheckResult, gatePasses } from './check';
import { VIRTUAL_ID, generateLocaleModule, generateRuntimeModule } from './codegen';
import type { ResolvedConfig, VerbalyConfig } from './config';
import type { MessageRegistry } from './registry';
import { analyzeFile } from './sfc';
import { transformCode, type TransformResult } from './transform';

export interface PluginOptions extends VerbalyConfig {
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
  if (id === RESOLVED_VIRTUAL_ID) return generateRuntimeModule(cfg);
  if (id.startsWith(LOCALE_MODULE_PREFIX)) {
    return generateLocaleModule(catalogs[id.slice(LOCALE_MODULE_PREFIX.length)] ?? {});
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
): { analysis: Analysis; result: TransformResult | null } {
  const analysis = analyzeFile(code, id);
  registry.update(id, analysis);
  return { analysis, result: transformCode(code, id, analysis) ?? null };
}

// the one build-blocking error message, kept in one place (undefined = gate on)
export function runBuildGate(
  cfg: ResolvedConfig,
  registry: MessageRegistry,
  failOnMissing?: boolean,
): void {
  const found = check(cfg, loadCatalogs(cfg), registry);
  // `failOnMissing: false` means "let me build with untranslated strings", never "let me
  // ship a translation that renders wrong": a missing one falls back to the source locale,
  // a broken one renders the wrong text or nothing at all
  const result = failOnMissing === false ? { ...found, missing: [] } : found;
  if (gatePasses(result)) return;
  throw new Error(
    `[verbaly] build blocked\n${formatCheckResult(result)}\n${checkNextSteps(result)}`,
  );
}
