import type { Catalog, Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import { effectiveDrafts, type Drafts } from './drafts';
import { flatten, type MessageTree } from 'verbaly';
import type { MessageRegistry } from './registry';
import { counted } from './text';
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
  const extracted = registry.messages();

  // one flat view per locale, like check: the shape t() sees, counted leaf by leaf
  const flat: Record<string, Catalog> = {};
  for (const locale of cfg.locales) {
    flat[locale] = flatten((catalogs[locale] ?? {}) as MessageTree);
  }
  const source = flat[cfg.sourceLocale] ?? {};
  const needed = new Set<string>([...extracted.keys(), ...Object.keys(source)]);
  const live = effectiveDrafts(drafts, flat);

  const locales: LocaleStatus[] = [];
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    const catalog = flat[locale] ?? {};
    let translated = 0;
    for (const key of needed) {
      if (catalog[key]) translated += 1;
    }
    let broken = 0;
    for (const [key, text] of Object.entries(catalog)) {
      if (!text) continue;
      const from = source[key] ?? extracted.get(key)?.message;
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
  const lines = [`[verbaly] ${counted(result.messages, 'message')} · source: ${result.source}`];
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
