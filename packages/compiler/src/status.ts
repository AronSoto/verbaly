import type { Catalogs } from './catalog';
import type { ResolvedConfig } from './config';
import { effectiveDrafts, type Drafts } from './drafts';
import type { MessageRegistry } from './registry';

export interface LocaleStatus {
  locale: string;
  translated: number;
  total: number;
  drafts: number;
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

  const locales: LocaleStatus[] = [];
  for (const locale of cfg.locales) {
    if (locale === cfg.sourceLocale) continue;
    let translated = 0;
    for (const key of needed) {
      if (catalogs[locale]?.[key]) translated += 1;
    }
    locales.push({ locale, translated, total: needed.size, drafts: live[locale]?.length ?? 0 });
  }
  return { messages: needed.size, source: cfg.sourceLocale, locales };
}

export function formatStatusResult(result: StatusResult): string {
  const lines = [`[verbaly] ${result.messages} messages · source: ${result.source}`];
  if (result.locales.length === 0) {
    lines.push('  no target locales (add locales to your config)');
    return lines.join('\n');
  }
  for (const { locale, translated, total, drafts } of result.locales) {
    const pct = total === 0 ? 100 : Math.floor((translated / total) * 100);
    const mark = translated === total ? ' ✓' : '';
    const draftNote = drafts > 0 ? `, ${drafts} unreviewed` : '';
    lines.push(`  ${locale}: ${translated}/${total} translated (${pct}%${draftNote})${mark}`);
  }
  return lines.join('\n');
}
