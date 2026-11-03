import { emptyCatalog, flatView, type Catalog, type Catalogs } from '../catalog/catalog';
import type { ResolvedConfig } from '../config/config';
import { effectiveDrafts, type Drafts } from '../catalog/drafts';
import { shippedCatalogs } from '../scan/extract';
import { outdatedTranslations, type Fingerprints } from '../catalog/state';
import type { MessageRegistry } from '../scan/registry';
import { counted } from '../util/text';
import { validateMessage, validatePair } from './validate';

export interface LocaleStatus {
  locale: string;
  translated: number;
  total: number;
  drafts: number;
  broken: number;
  outdated: number;
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
  drafts: Drafts = emptyCatalog(),
  fingerprints: Fingerprints = emptyCatalog(),
): StatusResult {
  const extracted = registry.messages();

  // one flat view per locale, like check: the shape t() sees, counted leaf by leaf
  const flat = emptyCatalog<Catalog>();
  for (const locale of cfg.locales) {
    flat[locale] = flatView(catalogs[locale] ?? {});
  }
  const source = flat[cfg.sourceLocale] ?? {};
  const needed = new Set<string>([...extracted.keys(), ...Object.keys(source)]);
  const live = effectiveDrafts(drafts, flat);
  // the text that ships, as check reads it, so status and check never disagree
  const shipped = shippedCatalogs(cfg, flat, registry);
  const sourceText = shipped[cfg.sourceLocale]!;
  const outdated = outdatedTranslations(cfg, shipped, fingerprints);

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
      const from = sourceText[key];
      const issues = [...validateMessage(text, locale), ...(from ? validatePair(from, text) : [])];
      if (issues.some((issue) => issue.severity === 'error')) broken += 1;
    }
    locales.push({
      locale,
      translated,
      total: needed.size,
      drafts: live[locale]?.length ?? 0,
      broken,
      outdated: outdated.filter((entry) => entry.locale === locale).length,
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
  for (const { locale, translated, total, drafts, broken, outdated } of result.locales) {
    const pct = total === 0 ? 100 : Math.floor((translated / total) * 100);
    const mark = translated === total && broken === 0 && outdated === 0 ? ' ✓' : '';
    const notes = [
      drafts > 0 ? `${drafts} unreviewed` : '',
      broken > 0 ? `${broken} broken` : '',
      outdated > 0 ? `${outdated} outdated` : '',
    ].filter(Boolean);
    const note = notes.length > 0 ? `, ${notes.join(', ')}` : '';
    lines.push(`  ${locale}: ${translated}/${total} translated (${pct}%${note})${mark}`);
  }
  return lines.join('\n');
}
