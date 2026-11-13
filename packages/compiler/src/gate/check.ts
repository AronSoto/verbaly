import { emptyCatalog, flatView, type Catalog, type Catalogs } from '../catalog/catalog';
import type { ResolvedConfig } from '../config/config';
import { shippedCatalogs } from '../scan/sync';
import { collisionEntries, siteOf, type CollisionEntry, type SourceSite } from './findings';
import type { MessageRegistry } from '../scan/registry';
import { outdatedTranslations, type OutdatedEntry } from '../catalog/state';
import type { Fingerprints } from '../catalog/lock';
import {
  gatePass,
  validateMessage,
  validatePair,
  type IssueSeverity,
  type StructureIssue,
} from './validate';
import { relativePath } from '../util/path';

export interface MissingEntry {
  locale: string;
  key: string;
  source?: string;
}

export interface UnknownEntry {
  key: string;
  files: string[];
}

export interface BrokenEntry {
  locale: string;
  key: string;
  severity: IssueSeverity;
  issue: string;
}

export interface ExtraEntry {
  locale: string;
  key: string;
  files: string[];
}

export interface DivergentEntry {
  key: string;
  catalog: string;
  code: SourceSite;
}

export type { CollisionEntry, SourceSite } from './findings';
export type { OutdatedEntry } from '../catalog/state';

export interface CheckResult {
  ok: boolean;
  missing: MissingEntry[];
  unknown: UnknownEntry[];
  broken: BrokenEntry[];
  extra: ExtraEntry[];
  collisions: CollisionEntry[];
  divergent: DivergentEntry[];
  outdated: OutdatedEntry[];
}

// a collision fails like a broken translation: one of its places renders another place's text
export function gatePasses(
  result: Pick<CheckResult, 'missing' | 'unknown' | 'broken' | 'collisions'>,
): boolean {
  return (
    result.missing.length === 0 &&
    result.unknown.length === 0 &&
    result.collisions.length === 0 &&
    !result.broken.some((entry) => entry.severity === 'error')
  );
}

// what a tool or a panel shows: check() names files by absolute path, a reader wants the project's
export function relativeCheck(root: string, result: CheckResult): CheckResult {
  const rel = (file: string): string => relativePath(root, file);
  return {
    ...result,
    unknown: result.unknown.map((entry) => ({ ...entry, files: entry.files.map(rel) })),
    extra: result.extra.map((entry) => ({ ...entry, files: entry.files.map(rel) })),
    collisions: result.collisions.map((entry) => ({
      ...entry,
      sites: entry.sites.map((at) => ({ ...at, file: rel(at.file) })),
    })),
    divergent: result.divergent.map((entry) => ({
      ...entry,
      code: { ...entry.code, file: rel(entry.code.file) },
    })),
  };
}

// every warning list, counted once: the build line and doctor say the same number
export function warningCount(result: CheckResult): number {
  return (
    result.broken.filter((entry) => entry.severity === 'warning').length +
    result.extra.length +
    result.divergent.length +
    result.outdated.length
  );
}

export function check(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
  fingerprints: Fingerprints = emptyCatalog(),
): CheckResult {
  return gatePass(() => checkPass(cfg, catalogs, registry, fingerprints));
}

// what check and status both start from, so the two never read a project differently
export function gateViews(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): { flat: Record<string, Catalog>; source: Catalog; shipped: Catalogs; sourceText: Catalog } {
  // one flat view per locale: the shape t() sees, so nested catalogs compare leaf by leaf
  const flat = emptyCatalog<Catalog>();
  for (const locale of cfg.locales) {
    flat[locale] = flatView(catalogs[locale] ?? {});
  }
  const source = flat[cfg.sourceLocale] ?? {};
  // the code's text is the one that ships, so every translation is read against it
  const shipped = shippedCatalogs(cfg, flat, registry);
  return { flat, source, shipped, sourceText: shipped[cfg.sourceLocale]! };
}

// what one translation gets wrong: on its own, then against the source text when there is one
export function translationIssues(
  locale: string,
  translated: string,
  text: string | undefined,
): StructureIssue[] {
  const issues = validateMessage(translated, locale);
  return text ? [...issues, ...validatePair(text, translated)] : issues;
}

function checkPass(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
  fingerprints: Fingerprints,
): CheckResult {
  const extracted = registry.messages();
  const { flat, source, shipped, sourceText } = gateViews(cfg, catalogs, registry);

  const used = registry.usedKeys();
  const unknown: UnknownEntry[] = [];
  // strict: a renamed t's text is never extracted, so its key is reported as renamed, not unknown
  for (const [key, files] of registry.usedKeys(true)) {
    const known =
      extracted.has(key) || cfg.locales.some((locale) => flat[locale]?.[key] !== undefined);
    if (!known) unknown.push({ key, files });
  }

  const needed = new Set<string>([...extracted.keys(), ...Object.keys(source)]);

  const missing: MissingEntry[] = [];
  for (const key of extracted.keys()) {
    if (!source[key]) {
      missing.push({ locale: cfg.sourceLocale, key, source: extracted.get(key)?.message });
    }
  }
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    for (const key of needed) {
      if (!flat[locale]?.[key]) {
        missing.push({ locale, key, source: source[key] ?? extracted.get(key)?.message });
      }
    }
  }

  // presence is not correctness: a translation can be there and still render wrong
  const broken: BrokenEntry[] = [];
  const add = (locale: string, key: string, issues: StructureIssue[]): void => {
    for (const issue of issues) {
      broken.push({ locale, key, severity: issue.severity, issue: issue.message });
    }
  };

  const divergent: DivergentEntry[] = [];
  for (const [key, entry] of extracted) {
    const written = source[key];
    if (written && written !== entry.message) {
      divergent.push({ key, catalog: written, code: siteOf(entry) });
    }
  }
  for (const [key, text] of Object.entries(sourceText)) {
    add(cfg.sourceLocale, key, validateMessage(text, cfg.sourceLocale));
  }
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    for (const [key, translated] of Object.entries(flat[locale] ?? {})) {
      if (!translated) continue; // '' is untranslated, already reported as missing
      add(locale, key, translationIssues(locale, translated, sourceText[key]));
    }
  }

  // dead weight in that language's download, or, when the code reads it, the raw key in the source
  const extra: ExtraEntry[] = [];
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    for (const key of Object.keys(flat[locale] ?? {})) {
      if (source[key] !== undefined || extracted.has(key)) continue;
      extra.push({ locale, key, files: used.get(key) ?? [] });
    }
  }

  const collisions = collisionEntries(registry);
  return {
    ok: gatePasses({ missing, unknown, broken, collisions }),
    missing,
    unknown,
    broken,
    extra,
    collisions,
    divergent,
    outdated: outdatedTranslations(cfg, shipped, fingerprints),
  };
}
