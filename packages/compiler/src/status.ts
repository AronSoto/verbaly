import type { Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import { effectiveDrafts, type Drafts } from './drafts';
import { flatten, type MessageTree } from 'verbaly';
import type { MessageRegistry } from './registry';
import { validateMessage, validatePair } from './validate';

export interface LocaleStatus {
  locale: string;
  translated: number;
  total: number;
  drafts: number;
  broken: number;
}

export interface StatusResult {
  messages: number;
  source: string;
  locales: LocaleStatus[];
}

// coverage overview for humans; check stays the CI gate
export function status(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  registry: MessageRegistry,
  drafts: Drafts = {},
): StatusResult {
  const source = catalogs[cfg.sourceLocale] ?? {};
  const needed = new Set<string>([...registry.messages().keys(), ...Object.keys(source)]);
  const live = effectiveDrafts(drafts, catalogs);

  const extracted = registry.messages();
  const locales: LocaleStatus[] = [];
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    let translated = 0;
    for (const key of needed) {
      if (catalogs[locale]?.[key]) translated += 1;
    }
    // counted over the flattened catalog: a nested hand-written one has no top-level messages
    let broken = 0;
    const flatSource = flatten((source ?? {}) as MessageTree);
    for (const [key, text] of Object.entries(flatten((catalogs[locale] ?? {}) as MessageTree))) {
      if (!text) continue;
      const from = flatSource[key] ?? extracted.get(key)?.message;
      const issues = [...validateMessage(text, locale), ...(from ? validatePair(from, text) : [])];
      if (issues.some((issue) => issue.severity === 'error')) broken += 1;
    }
    locales.push({
      locale,
      translated,
      total: needed.size,
      drafts: live[locale]?.length ?? 0,
      broken,
    });
  }
  return { messages: needed.size, source: cfg.sourceLocale, locales };
}

export function formatStatusResult(result: StatusResult): string {
  const lines = [`[verbaly] ${result.messages} messages · source: ${result.source}`];
  if (result.locales.length === 0) {
    lines.push('  no target locales (add locales to your config)');
    return lines.join('\n');
  }
  for (const { locale, translated, total, drafts, broken } of result.locales) {
    const pct = total === 0 ? 100 : Math.floor((translated / total) * 100);
    const mark = translated === total && broken === 0 ? ' ✓' : '';
    const notes = [
      drafts > 0 ? `${drafts} unreviewed` : '',
      broken > 0 ? `${broken} broken` : '',
    ].filter(Boolean);
    const note = notes.length > 0 ? `, ${notes.join(', ')}` : '';
    lines.push(`  ${locale}: ${translated}/${total} translated (${pct}%${note})${mark}`);
  }
  return lines.join('\n');
}
