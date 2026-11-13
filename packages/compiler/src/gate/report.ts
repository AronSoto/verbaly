import { catalogPath } from '../catalog/catalog';
import type { ResolvedConfig } from '../config/config';
import { CLI_INSTALL_FIX } from '../config/host';
import type { MessageRegistry } from '../scan/registry';
import { counted, truncate } from '../util/text';
import type { CheckResult, MissingEntry } from './check';
import { formatCollision, formatFinding, sourcePlace } from './findings';
import { relativePath } from '../util/path';

// root makes the paths readable: an absolute path is noise in the one message people are stuck on
export function formatCheckResult(result: CheckResult, root?: string): string {
  const show = (file: string) => (root ? relativePath(root, file) : file);
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
  if (result.collisions.length > 0) {
    lines.push('keys written with more than one text:');
    for (const entry of result.collisions) lines.push(`  ${formatCollision(entry, root)}`);
  }
  return lines.join('\n');
}

// what a build prints instead of stopping: the broken first, since those render wrong
export function formatBuildReport(
  result: Pick<CheckResult, 'missing' | 'unknown' | 'broken' | 'collisions'>,
  sourceLocale: string,
  root?: string,
  cap = 5,
): string[] {
  const show = (file: string) => (root ? relativePath(root, file) : file);
  const lines: string[] = [];
  const list = <T>(entries: T[], line: (entry: T) => string): void => {
    for (const entry of entries.slice(0, cap)) lines.push(`  ${line(entry)}`);
    if (entries.length > cap) lines.push(`  and ${entries.length - cap} more`);
  };
  const broken = result.broken.filter((entry) => entry.severity === 'error');
  if (broken.length > 0) {
    lines.push(
      `✗ the build goes on with ${counted(broken.length, 'broken translation')}, each rendering differently from its source:`,
    );
    list(broken, (entry) => `[${entry.locale}] ${entry.key}: ${entry.issue}`);
  }
  if (result.collisions.length > 0) {
    lines.push(
      `✗ the build goes on with ${counted(result.collisions.length, 'key')} written with more than one text:`,
    );
    list(result.collisions, (entry) => formatCollision(entry, root));
  }
  const quoted = (entry: MissingEntry) => (entry.source ? `: "${truncate(entry.source, 40)}"` : '');
  const untranslated = result.missing.filter((entry) => entry.locale !== sourceLocale);
  if (untranslated.length > 0) {
    lines.push(
      `⚠ the build goes on without ${counted(untranslated.length, 'translation')}, shown in ${sourceLocale} instead:`,
    );
    list(untranslated, (entry) => `[${entry.locale}] ${entry.key}${quoted(entry)}`);
  }
  if (result.unknown.length > 0) {
    lines.push(
      `⚠ the build goes on with ${counted(result.unknown.length, 'key')} no catalog has, so the key itself shows:`,
    );
    list(result.unknown, (entry) => `${entry.key} (used in ${entry.files.map(show).join(', ')})`);
  }
  // the code's text ships, so these render right, and one extract adds them all: a count says it
  const unsynced = result.missing.filter((entry) => entry.locale === sourceLocale);
  if (unsynced.length > 0) {
    lines.push(
      `⚠ the build goes on with ${counted(unsynced.length, 'text')} the ${sourceLocale} catalog does not have yet, taken from the code`,
    );
  }
  return lines;
}

// what to do about each kind of failure: extract only fixes one of them
export function checkNextSteps(result: CheckResult, cliReachable = true): string {
  const steps: string[] = [];
  if (result.missing.length > 0) {
    // extract writes "" for a new key, so filling is the step left once it ran
    steps.push(
      'missing: fill the empty translations in your catalogs, or run `npx verbaly translate` (`npx verbaly extract` adds a key a catalog does not have yet)',
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
  if (result.collisions.length > 0) {
    steps.push(
      'collisions: give each text its own key in t.id(…), or write the same text in every place',
    );
  }
  // the gate prints from inside a build, where the command it just named may not exist at all
  if (steps.length > 0 && !cliReachable) {
    steps.push(`the verbaly command is not linked in this project: ${CLI_INSTALL_FIX}`);
  }
  return steps.join('\n');
}

export interface CheckReportOptions {
  // check --outdated fails on them, so they are printed with the failures, not as warnings
  outdatedFails?: boolean;
}

// warnings never fail the gate, so they print on their own
export function formatCheckWarnings(
  result: CheckResult,
  root?: string,
  options: CheckReportOptions = {},
): string {
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
  for (const { key, catalog, code } of result.divergent) {
    lines.push(
      `  ${key}: the source catalog says "${truncate(catalog, 40)}" and the code says ` +
        `"${truncate(code.message, 40)}" (${sourcePlace(code, root)}): ` +
        'the code wins, so edit the text there (extract writes it into the catalog)',
    );
  }
  if (!options.outdatedFails) {
    for (const entry of result.outdated) {
      lines.push(`  ${formatFinding({ kind: 'outdated', ...entry }, root)}`);
    }
  }
  return lines.join('\n');
}

// GitHub workflow commands: every failure becomes a clickable ::error annotation on the PR
export function githubCheckAnnotations(
  result: CheckResult,
  registry: MessageRegistry,
  cfg: ResolvedConfig,
  options: CheckReportOptions = {},
): string[] {
  const messages = registry.messages();
  const rel = (file: string): string => escapeProperty(relativePath(cfg.root, file));
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
      lines.push(`::error ${at(origin.file, origin.line)}::${text}`);
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
    lines.push(`::${command} ${at(origin.file, origin.line)}::${text}`);
  }

  for (const entry of result.extra) {
    const text = escapeData(`[${entry.locale}] ${entry.key}: only this translation has it`);
    const file = entry.files[0];
    lines.push(file ? `::warning file=${rel(file)}::${text}` : `::warning::${text}`);
  }

  // one per place a colliding text is written, so the PR shows every one of them
  for (const { key, sites } of result.collisions) {
    const texts = new Set(sites.map((place) => place.message)).size;
    const text = escapeData(
      `"${key}" has ${counted(texts, 'text')}, and every place shows the first one`,
    );
    for (const place of sites) lines.push(`::error ${at(place.file, place.line)}::${text}`);
  }
  for (const { key, code } of result.divergent) {
    const text = escapeData(`"${key}": the source catalog has another text, the code's one ships`);
    lines.push(`::warning ${at(code.file, code.line)}::${text}`);
  }
  // the translation lives in its catalog, and under --outdated it is what fails the job
  const outdated = options.outdatedFails ? 'error' : 'warning';
  for (const { locale, key } of result.outdated) {
    const text = escapeData(`[${locale}] ${key}: translated from an older source text`);
    lines.push(`::${outdated} file=${rel(catalogPath(cfg, locale))}::${text}`);
  }
  return lines;
}

function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
