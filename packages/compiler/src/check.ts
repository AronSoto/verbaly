import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import type { MessageRegistry } from './registry';

export interface MissingEntry {
  locale: string;
  key: string;
  source?: string;
}

export interface UnknownEntry {
  key: string;
  files: string[];
}

export interface CheckResult {
  ok: boolean;
  missing: MissingEntry[];
  unknown: UnknownEntry[];
}

export function check(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
): CheckResult {
  const source = catalogs[cfg.sourceLocale] ?? {};
  const extracted = registry.messages();

  const unknown: UnknownEntry[] = [];
  for (const [key, files] of registry.usedKeys()) {
    const known =
      extracted.has(key) || cfg.locales.some((locale) => catalogs[locale]?.[key] !== undefined);
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
      if (!catalogs[locale]?.[key]) {
        missing.push({ locale, key, source: source[key] ?? extracted.get(key)?.message });
      }
    }
  }

  return { ok: missing.length === 0 && unknown.length === 0, missing, unknown };
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
