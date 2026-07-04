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
      const hint = entry.source ? ` — "${truncate(entry.source, 40)}"` : '';
      lines.push(`  [${entry.locale}] ${entry.key}${hint}`);
    }
  }
  if (result.unknown.length > 0) {
    lines.push('unknown keys (not in any catalog):');
    for (const entry of result.unknown) {
      lines.push(`  ${entry.key} — used in ${entry.files.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
