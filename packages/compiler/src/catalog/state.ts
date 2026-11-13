import { existsSync } from 'node:fs';
import { flatten, type MessageTree } from 'verbaly';
import { catalogPath, emptyCatalog, own, type Catalog, type Catalogs } from './catalog';
import { targetLocales, type ResolvedConfig } from '../config/config';
import {
  clearDrafts,
  fingerprint,
  loadState,
  markDrafts,
  saveState,
  sourceOf,
  stamp,
  translationOf,
  type Drafts,
  type Fingerprints,
  type State,
} from './lock';
import { stableKey } from '../util/key';
import { byCodeUnit } from '../util/text';

export interface OutdatedEntry {
  locale: string;
  key: string;
}

// a translation just written, and the source text it was written for when that is not today's
export interface WrittenTranslation {
  key: string;
  text: string;
  source?: string;
}

export interface TranslationWrite {
  locale: string;
  entries: WrittenTranslation[];
  draft?: boolean;
}

// the state follows the catalogs it is shown; a locale whose catalog was not read stays as it was
export function updateState(cfg: ResolvedConfig, catalogs: Catalogs): State {
  const next = refreshState(cfg, catalogs, loadState(cfg));
  saveState(cfg, next);
  return next;
}

function refreshState(cfg: ResolvedConfig, catalogs: Catalogs, previous: State): State {
  const flat = flatCatalogs(catalogs);
  const source = flat[cfg.sourceLocale] ?? {};
  // a narrowed --locales run, or a catalog missing mid-checkout, must never erase what it held
  const shown = new Set(
    targetLocales(cfg).filter(
      (locale) => Object.hasOwn(flat, locale) && existsSync(catalogPath(cfg, locale)),
    ),
  );
  const drafts: Drafts = emptyCatalog();
  for (const [locale, keys] of Object.entries(previous.drafts)) {
    if (!shown.has(locale)) {
      drafts[locale] = keys;
      continue;
    }
    // a draft counts only while its translation is present: a pruned key is missing, not a draft
    const live = keys.filter((key) => own(flat[locale]!, key));
    if (live.length) drafts[locale] = live;
  }
  const fingerprints: Fingerprints = emptyCatalog();
  for (const [locale, stamps] of Object.entries(previous.fingerprints)) {
    if (!shown.has(locale)) fingerprints[locale] = stamps;
  }
  for (const locale of shown) {
    const stamps = refreshStamps(source, flat[locale]!, previous.fingerprints[locale] ?? {});
    if (Object.keys(stamps).length) fingerprints[locale] = stamps;
  }
  return { drafts, fingerprints, migrated: previous.migrated };
}

// a stamp lives as long as its translation: kept while the translation is unchanged
function refreshStamps(
  source: Catalog,
  catalog: Catalog,
  before: Record<string, string>,
): Record<string, string> {
  const after: Record<string, string> = emptyCatalog();
  for (const key of new Set([...Object.keys(before), ...Object.keys(source)])) {
    const translated = own(catalog, key);
    if (!translated) continue;
    const was = own(before, key);
    if (was !== undefined && translationOf(was) === fingerprint(translated)) {
      after[key] = was;
      continue;
    }
    const text = own(source, key);
    // a new or edited translation was written for the source as it reads now
    if (text && tracked(key, text)) after[key] = stamp(text, translated);
    // edited while its source is empty: the old stamp waits until there is a source again
    else if (was !== undefined) after[key] = was;
  }
  return after;
}

// a translation written now was written for a known source: stamped and flagged in one save
export function recordTranslations(
  cfg: ResolvedConfig,
  source: Catalog,
  writes: TranslationWrite[],
): State {
  const state = loadState(cfg);
  for (const { locale, entries, draft } of writes) {
    if (entries.length === 0) continue;
    const stamps = (state.fingerprints[locale] ??= emptyCatalog());
    for (const entry of entries) {
      const from = entry.source || own(source, entry.key);
      if (from && entry.text && tracked(entry.key, from)) {
        stamps[entry.key] = stamp(from, entry.text);
      }
    }
    const keys = entries.map((entry) => entry.key);
    if (draft === true) markDrafts(state.drafts, locale, keys);
    else if (draft === false) clearDrafts(state.drafts, locale, keys);
  }
  saveState(cfg, state);
  return state;
}

// a draft counts only while its translation is present: a pruned key is missing, not a draft
export function effectiveDrafts(drafts: Drafts, catalogs: Catalogs): Drafts {
  const out: Drafts = emptyCatalog();
  for (const [locale, keys] of Object.entries(drafts)) {
    const catalog = catalogs[locale] ?? {};
    const live = keys.filter((key) => own(catalog, key));
    if (live.length) out[locale] = live;
  }
  return out;
}

// a hash key is its own text: a new text is a new key, so its translation can never be stale
function tracked(key: string, text: string): boolean {
  return stableKey(text) !== key;
}

export function outdatedTranslations(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  fingerprints: Fingerprints,
): OutdatedEntry[] {
  const source = catalogs[cfg.sourceLocale] ?? {};
  const out: OutdatedEntry[] = [];
  for (const locale of targetLocales(cfg)) {
    const catalog = catalogs[locale] ?? {};
    for (const [key, was] of Object.entries(fingerprints[locale] ?? {})) {
      const text = own(source, key);
      const translated = own(catalog, key);
      if (!text || !translated) continue;
      // edited since it was stamped: whoever touched it last wrote it against this source
      if (translationOf(was) !== fingerprint(translated)) continue;
      if (sourceOf(was) !== fingerprint(text)) out.push({ locale, key });
    }
  }
  // code unit order, the one the catalogs use: localeCompare differs from machine to machine
  return out.sort((a, b) => byCodeUnit(a.locale, b.locale) || byCodeUnit(a.key, b.key));
}

// a person read it against the new source and kept it: stamp it as written for that source
export function acceptOutdated(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  fingerprints: Fingerprints,
  entries: OutdatedEntry[],
): void {
  const source = catalogs[cfg.sourceLocale] ?? {};
  for (const { locale, key } of entries) {
    const text = own(source, key);
    const translated = own(catalogs[locale] ?? {}, key);
    if (!text || !translated) continue;
    (fingerprints[locale] ??= emptyCatalog())[key] = stamp(text, translated);
  }
}

// a caller may hand nested groups, and every key here is the dotted one t() reads
function flatCatalogs(catalogs: Catalogs): Catalogs {
  const out = emptyCatalog<Catalog>();
  for (const [locale, catalog] of Object.entries(catalogs)) {
    out[locale] = flatten(catalog as unknown as MessageTree);
  }
  return out;
}
