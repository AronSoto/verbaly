import { loadCatalogs } from '../../catalog/catalog';
import {
  acceptOutdated,
  clearDrafts,
  effectiveDrafts,
  loadState,
  outdatedTranslations,
  saveState,
  stateFile,
} from '../../catalog/state';
import type { ResolvedConfig } from '../../config/config';
import { extractProject, shippedCatalogs } from '../../scan/extract';
import { counted, truncate } from '../../util/text';
import type { CliValues } from '../args';
import { byLocale, sayLockNews } from '../output';

export async function reviewCommand(
  cfg: ResolvedConfig,
  values: CliValues,
  positionals: string[],
): Promise<void> {
  const registry = await extractProject(cfg);
  const catalogs = loadCatalogs(cfg);
  // outdated against the text that ships, the one status and check count it against
  const shipped = shippedCatalogs(cfg, catalogs, registry);
  const state = loadState(cfg);
  const only = new Set(positionals.slice(1));
  const wanted = ({ locale, key }: { locale: string; key: string }): boolean =>
    (!values.locale || locale === values.locale) && (only.size === 0 || only.has(key));
  const drafts = Object.entries(effectiveDrafts(state.drafts, catalogs))
    .flatMap(([locale, keys]) => keys.map((key) => ({ locale, key })))
    .filter(wanted);
  const outdated = outdatedTranslations(cfg, shipped, state.fingerprints).filter(wanted);

  if (drafts.length === 0 && outdated.length === 0) {
    console.log('[verbaly] nothing awaiting review ✓');
    return;
  }

  if (values.approve) {
    for (const [locale, keys] of byLocale(drafts)) {
      clearDrafts(state.drafts, locale, keys);
      console.log(`  ${locale}: ${keys.length} approved`);
    }
    // a person read the old translation against the new source and kept it
    acceptOutdated(cfg, shipped, state.fingerprints, outdated);
    for (const [locale, keys] of byLocale(outdated)) {
      console.log(`  ${locale}: ${keys.length} kept for the new source text`);
    }
    const lockBefore = stateFile(cfg);
    saveState(cfg, state);
    sayLockNews(cfg, lockBefore);
    // a draft can be outdated as well, and it is still one translation reviewed
    const reviewed = new Set([...drafts, ...outdated].map(({ locale, key }) => `${locale}:${key}`));
    console.log(`[verbaly] ${counted(reviewed.size, 'translation')} marked reviewed ✓`);
    return;
  }

  // a key alone cannot be judged: each line shows the text that ships and its translation
  const source = shipped[cfg.sourceLocale] ?? {};
  const show = (locale: string, keys: string[]): void => {
    console.log(`  ${locale}:`);
    for (const key of keys) {
      const translated = catalogs[locale]?.[key] ?? '';
      console.log(
        `    ${key}: "${truncate(source[key] ?? '', 60)}" → "${truncate(translated, 60)}"`,
      );
    }
  };
  if (drafts.length > 0) {
    console.log(
      `[verbaly] ${counted(drafts.length, 'machine translation')} awaiting review (--approve to accept)`,
    );
    for (const [locale, keys] of byLocale(drafts)) show(locale, keys);
  }
  if (outdated.length > 0) {
    console.log(
      `[verbaly] ${counted(outdated.length, 'translation')} written for an older source text (update them, or --approve keeps them)`,
    );
    for (const [locale, keys] of byLocale(outdated)) show(locale, keys);
  }
}
