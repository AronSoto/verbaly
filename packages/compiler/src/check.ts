import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { flatten, type MessageTree } from 'verbaly';
import type { Catalog, Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import type { MessageRegistry } from './registry';
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

export interface CheckResult {
  ok: boolean;
  missing: MissingEntry[];
  unknown: UnknownEntry[];
  broken: BrokenEntry[];
}

export function gatePasses(result: Omit<CheckResult, 'ok'>): boolean {
  return (
    result.missing.length === 0 &&
    result.unknown.length === 0 &&
    !result.broken.some((entry) => entry.severity === 'error')
  );
}

export function check(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): CheckResult {
  const extracted = registry.messages();

  // one flat view per locale: the shape t() sees, so nested catalogs compare leaf by leaf
  const flat: Record<string, Catalog> = {};
  for (const locale of cfg.locales) {
    flat[locale] = flatten((catalogs[locale] ?? {}) as MessageTree);
  }
  const source = flat[cfg.sourceLocale] ?? {};

  const unknown: UnknownEntry[] = [];
  for (const [key, files] of registry.usedKeys()) {
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

  // a key can be used in code before it reaches the catalog: validate that text too
  const sourceText: Catalog = { ...source };
  for (const [key, entry] of extracted) {
    if (!sourceText[key]) sourceText[key] = entry.message;
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

  return { ok: gatePasses({ missing, unknown, broken }), missing, unknown, broken };
}

export function formatCheckResult(result: CheckResult): string {
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
      lines.push(`  ${entry.key} (used in ${entry.files.join(', ')})`);
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
export function checkNextSteps(result: CheckResult): string {
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
  return steps.join('\n');
}

// warnings never fail the gate, so they print on their own
export function formatCheckWarnings(result: CheckResult): string {
  return result.broken
    .filter((entry) => entry.severity === 'warning')
    .map((entry) => `  [${entry.locale}] ${entry.key}: ${entry.issue}`)
    .join('\n');
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
  const contents = new Map<string, string | undefined>();
  const readSource = (file: string): string | undefined => {
    if (!contents.has(file)) {
      try {
        contents.set(file, readFileSync(file, 'utf8'));
      } catch {
        contents.set(file, undefined);
      }
    }
    return contents.get(file);
  };

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
      const file = relative(root, origin.file).replaceAll('\\', '/');
      const content = readSource(origin.file);
      const line = content === undefined ? undefined : lineAt(content, origin.start);
      lines.push(`::error file=${escapeProperty(file)}${line ? `,line=${line}` : ''}::${text}`);
    } else {
      lines.push(`::error::${text}`);
    }
  }

  for (const entry of result.unknown) {
    const text = escapeData(`unknown key "${entry.key}" (not in any catalog)`);
    const file = entry.files[0];
    lines.push(
      file
        ? `::error file=${escapeProperty(relative(root, file).replaceAll('\\', '/'))}::${text}`
        : `::error::${text}`,
    );
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
    const file = relative(root, origin.file).replaceAll('\\', '/');
    const content = readSource(origin.file);
    const line = content === undefined ? undefined : lineAt(content, origin.start);
    lines.push(`::${command} file=${escapeProperty(file)}${line ? `,line=${line}` : ''}::${text}`);
  }
  return lines;
}

function lineAt(content: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

function escapeData(text: string): string {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replaceAll(':', '%3A').replaceAll(',', '%2C');
}
