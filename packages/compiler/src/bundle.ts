import type { Catalog, Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import type { MessageRegistry } from './registry';
import { counted } from './text';

// segment prefix, never substring: excluding "nav" must not take "navbar_x" with it
function isExcluded(key: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

// what the browser gets; render and the gate keep reading the full catalogs from disk
export function clientCatalogs(cfg: ResolvedConfig, catalogs: Catalogs): Catalogs {
  const prefixes = cfg.bundle.exclude ?? [];
  if (prefixes.length === 0) return catalogs;
  const out: Catalogs = {};
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const kept: Catalog = {};
    for (const [key, message] of Object.entries(catalog)) {
      if (!isExcluded(key, prefixes)) kept[key] = message;
    }
    out[locale] = kept;
  }
  return out;
}

export interface BundleIssue {
  prefix: string;
  problem: string;
  fix: string;
}

// never a gate failure: an excluded namespace builds, it just may not be there when code asks
export function auditBundle(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): BundleIssue[] {
  const prefixes = cfg.bundle.exclude ?? [];
  if (prefixes.length === 0) return [];
  const source = Object.keys(catalogs[cfg.sourceLocale] ?? {});
  const used = registry.usedKeys();

  const issues: BundleIssue[] = [];
  for (const prefix of prefixes) {
    if (!source.some((key) => isExcluded(key, [prefix]))) {
      issues.push({
        prefix,
        problem: `matches no key in ${cfg.sourceLocale}.json, so it excludes nothing`,
        fix: 'check the spelling against your catalog, or drop it from bundle.exclude',
      });
      continue;
    }
    const files = new Set<string>();
    for (const [key, where] of used) {
      if (isExcluded(key, [prefix])) for (const file of where) files.add(file);
    }
    if (files.size > 0) {
      issues.push({
        prefix,
        problem: `is read by t() in ${counted(files.size, 'file')}, where it resolves to the key itself`,
        fix: 'pre-render those pages with render, load the group with addMessages, or stop excluding it',
      });
    }
  }
  return issues;
}

// one wording for the build gate and for doctor, so the two can never say different things
export function formatBundleIssue(issue: BundleIssue): string {
  return `bundle.exclude "${issue.prefix}" ${issue.problem}`;
}
