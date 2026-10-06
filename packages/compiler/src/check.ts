import { relative } from 'node:path';
import { flatten, type MessageTree } from 'verbaly';
import type { TaggedMessage } from './analyze';
import { emptyCatalog, type Catalog, type Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import { CLI_INSTALL_FIX } from './init';
import { createLocator } from './location';
import type { MessageRegistry } from './registry';
import { outdatedTranslations, type Fingerprints, type OutdatedEntry } from './state';
import { counted } from './text';
import { validateMessage, validatePair, type IssueSeverity, type StructureIssue } from './validate';

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

// where a text is written in the code: an absolute file, like every path check reports
export interface SourceSite {
  file: string;
  line?: number;
  message: string;
}

export interface CollisionEntry {
  key: string;
  sites: SourceSite[];
}

export interface DivergentEntry {
  key: string;
  catalog: string;
  code: SourceSite;
}

export type { OutdatedEntry } from './state';

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

export function gatePasses(result: Pick<CheckResult, 'missing' | 'unknown' | 'broken'>): boolean {
  return (
    result.missing.length === 0 &&
    result.unknown.length === 0 &&
    !result.broken.some((entry) => entry.severity === 'error')
  );
}

// every warning list, counted once: the build line and doctor say the same number
export function warningCount(result: CheckResult): number {
  return (
    result.broken.filter((entry) => entry.severity === 'warning').length +
    result.extra.length +
    result.collisions.length +
    result.divergent.length +
    result.outdated.length
  );
}

export function check(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
  fingerprints: Fingerprints = {},
): CheckResult {
  const extracted = registry.messages();
  const locate = createLocator();
  const site = (msg: TaggedMessage): SourceSite => ({
    file: msg.file,
    line: locate(msg.file, msg.start),
    message: msg.message,
  });

  // one flat view per locale: the shape t() sees, so nested catalogs compare leaf by leaf
  const flat: Record<string, Catalog> = {};
  for (const locale of cfg.locales) {
    flat[locale] = flatten((catalogs[locale] ?? {}) as MessageTree);
  }
  const source = flat[cfg.sourceLocale] ?? {};

  const used = registry.usedKeys();
  const unknown: UnknownEntry[] = [];
  // strict: a key only spelled in backticks never failed the gate, and it does not start to here
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

  // the code's text is the one that ships, so a translation is checked against it, not the catalog
  const sourceText: Catalog = Object.assign(emptyCatalog(), source);
  const divergent: DivergentEntry[] = [];
  for (const [key, entry] of extracted) {
    const written = sourceText[key];
    if (written && written !== entry.message) {
      divergent.push({ key, catalog: written, code: site(entry) });
    }
    sourceText[key] = entry.message;
  }
  for (const [key, text] of Object.entries(sourceText)) {
    add(cfg.sourceLocale, key, validateMessage(text, cfg.sourceLocale));
  }
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    for (const [key, translated] of Object.entries(flat[locale] ?? {})) {
      if (!translated) continue; // '' is untranslated, already reported as missing
      add(locale, key, validateMessage(translated, locale));
      const text = sourceText[key];
      if (text) add(locale, key, validatePair(text, translated));
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

  const collisions = collisionEntries(registry, locate);
  const outdated = outdatedTranslations(cfg, flat, fingerprints);

  return {
    ok: gatePasses({ missing, unknown, broken }),
    missing,
    unknown,
    broken,
    extra,
    collisions,
    divergent,
    outdated,
  };
}

// root makes the paths readable: an absolute path is noise in the one message people are stuck on
export function formatCheckResult(result: CheckResult, root?: string): string {
  const show = (file: string) => (root ? relative(root, file).replaceAll('\\', '/') : file);
  const lines: string[] = [];
  if (result.missing.length > 0) {
    lines.push('missing translations:');
    for (const entry of result.missing) {
      const hint = entry.source ? `: "${truncate(entry.source, 40)}"` : '';
      lines.push(`  [${entry.locale}] ${entry.key}${hint}`);
    }
  }
  if (result.unknown.length > 0) {
    lines.push('unknown keys (not in any catalog):');
    for (const entry of result.unknown) {
      lines.push(`  ${entry.key} (used in ${entry.files.map(show).join(', ')})`);
    }
  }
  const errors = result.broken.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    lines.push('broken translations:');
    for (const entry of errors) lines.push(`  [${entry.locale}] ${entry.key}: ${entry.issue}`);
  }
  return lines.join('\n');
}

// what to do about each kind of failure: extract only fixes one of the three
export function checkNextSteps(result: CheckResult, cliReachable = true): string {
  const steps: string[] = [];
  if (result.missing.length > 0) {
    steps.push(
      'missing: run `npx verbaly extract` to scaffold the keys, then fill them (or run `npx verbaly translate`)',
    );
  }
  if (result.unknown.length > 0) {
    steps.push(
      'unknown keys: the key used in the code is in no catalog, fix the key or run `npx verbaly extract`',
    );
  }
  if (result.broken.some((entry) => entry.severity === 'error')) {
    steps.push(
      'broken: a translation has to keep the params, tags and plural cases of its source message',
    );
  }
  // the gate prints from inside a build, where the command it just named may not exist at all
  if (steps.length > 0 && !cliReachable) {
    steps.push(`the verbaly command is not linked in this project: ${CLI_INSTALL_FIX}`);
  }
  return steps.join('\n');
}

export function collisionEntries(
  registry: MessageRegistry,
  locate = createLocator(),
): CollisionEntry[] {
  return registry.collisions().map(({ key, kept, dropped }) => ({
    key,
    sites: [kept, ...dropped].map((msg) => ({
      file: msg.file,
      line: locate(msg.file, msg.start),
      message: msg.message,
    })),
  }));
}

// file:line, so the editor and the terminal can jump to where the text is written
export function sourcePlace(at: SourceSite, root?: string): string {
  const file = root ? relative(root, at.file).replaceAll('\\', '/') : at.file;
  return at.line ? `${file}:${at.line}` : file;
}

function quoted(at: SourceSite, root?: string): string {
  return `"${truncate(at.message, 40)}" (${sourcePlace(at, root)})`;
}

// the one wording of a collision, shared by extract and check
export function formatCollision({ key, sites }: CollisionEntry, root?: string): string {
  const [kept, ...others] = sites as [SourceSite, ...SourceSite[]];
  return (
    `  ${key}: one key with ${counted(sites.length, 'text')}, and every place shows ${quoted(kept, root)}, ` +
    `never ${others.map((at) => quoted(at, root)).join(' or ')}: give each text its own key`
  );
}

// warnings never fail the gate, so they print on their own
export function formatCheckWarnings(result: CheckResult, root?: string): string {
  const lines = result.broken
    .filter((entry) => entry.severity === 'warning')
    .map((entry) => `  [${entry.locale}] ${entry.key}: ${entry.issue}`);
  for (const entry of result.extra) {
    lines.push(
      entry.files.length > 0
        ? `  [${entry.locale}] ${entry.key}: only this translation has it, so the source language shows the key itself`
        : `  [${entry.locale}] ${entry.key}: only this translation has it, and no code reads it`,
    );
  }
  for (const entry of result.collisions) lines.push(formatCollision(entry, root));
  for (const { key, catalog, code } of result.divergent) {
    lines.push(
      `  ${key}: the source catalog says "${truncate(catalog, 40)}" and the code says ${quoted(code, root)}: ` +
        'the code wins, so edit the text there (extract writes it into the catalog)',
    );
  }
  for (const { locale, key } of result.outdated) {
    lines.push(
      `  [${locale}] ${key}: translated from an older source text, ` +
        'update it or keep it with `npx verbaly review --approve`',
    );
  }
  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// GitHub workflow commands: every failure becomes a clickable ::error annotation on the PR
export function githubCheckAnnotations(
  result: CheckResult,
  registry: MessageRegistry,
  root: string,
): string[] {
  const messages = registry.messages();
  const locate = createLocator();
  const rel = (file: string): string => escapeProperty(relative(root, file).replaceAll('\\', '/'));
  const at = (file: string, line: number | undefined): string =>
    `file=${rel(file)}${line ? `,line=${line}` : ''}`;

  const lines: string[] = [];

  // one annotation per key, locales grouped: N locales must not bury the PR in N copies
  const byKey = new Map<string, MissingEntry & { locales: string[] }>();
  for (const entry of result.missing) {
    const grouped = byKey.get(entry.key);
    if (grouped) grouped.locales.push(entry.locale);
    else byKey.set(entry.key, { ...entry, locales: [entry.locale] });
  }

  for (const entry of byKey.values()) {
    const origin = messages.get(entry.key);
    const hint = entry.source ? `: "${truncate(entry.source, 60)}"` : '';
    const text = escapeData(`missing [${entry.locales.join(', ')}] ${entry.key}${hint}`);
    if (origin) {
      lines.push(`::error ${at(origin.file, locate(origin.file, origin.start))}::${text}`);
    } else {
      lines.push(`::error::${text}`);
    }
  }

  for (const entry of result.unknown) {
    const text = escapeData(`unknown key "${entry.key}" (not in any catalog)`);
    const file = entry.files[0];
    lines.push(file ? `::error file=${rel(file)}::${text}` : `::error::${text}`);
  }

  // a broken translation points at the source line that wrote the message
  for (const entry of result.broken) {
    const origin = messages.get(entry.key);
    const text = escapeData(`[${entry.locale}] ${entry.key}: ${entry.issue}`);
    const command = entry.severity === 'error' ? 'error' : 'warning';
    if (!origin) {
      lines.push(`::${command}::${text}`);
      continue;
    }
    lines.push(`::${command} ${at(origin.file, locate(origin.file, origin.start))}::${text}`);
  }

  for (const entry of result.extra) {
    const text = escapeData(`[${entry.locale}] ${entry.key}: only this translation has it`);
    const file = entry.files[0];
    lines.push(file ? `::warning file=${rel(file)}::${text}` : `::warning::${text}`);
  }

  // one per place a colliding text is written, so the PR shows every one of them
  for (const { key, sites } of result.collisions) {
    const text = escapeData(
      `"${key}" has ${counted(sites.length, 'text')}, and every place shows the first one`,
    );
    for (const place of sites) lines.push(`::warning ${at(place.file, place.line)}::${text}`);
  }
  for (const { key, code } of result.divergent) {
    const text = escapeData(`"${key}": the source catalog has another text, the code's one ships`);
    lines.push(`::warning ${at(code.file, code.line)}::${text}`);
  }
  for (const { locale, key } of result.outdated) {
    const text = escapeData(`[${locale}] ${key}: translated from an older source text`);
    lines.push(`::warning::${text}`);
  }
  return lines;
}

function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
