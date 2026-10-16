import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { flatten, type MessageTree } from 'verbaly';
import {
  catalogPath,
  emptyCatalog,
  own,
  readCatalog,
  type Catalog,
  type Catalogs,
} from './catalog';
import { targetLocales, type ResolvedConfig } from './config';
import { withLineEndings } from './eol';
import { stableKey } from './key';
import { byCodeUnit } from './text';

// a lockfile next to the config: committed, written by the tools, never edited by hand
export const STATE_FILE = 'verbaly.lock';
const LOCK_VERSION = 1;
const README =
  'Written by Verbaly: the source text each translation was made for, which ones are drafts, and which languages migrate converted. Commit it with your catalogs and never edit it: deleting it marks every draft as reviewed.';
// where the state lived before 0.71.0, next to the catalogs: an older teammate still writes it
const LEGACY_STATE_FILE = '.verbaly-state.json';
// before 0.67.0 that file held only the drafts
const LEGACY_DRAFTS_FILE = '.verbaly-drafts.json';
// locks a save just rewrote over a merge conflict, until the run that saved them reports it
const resolved = new Set<string>();

export type Drafts = Record<string, string[]>;

// locale -> key -> "<source>.<translation>" fingerprints from when that translation was written
export type Fingerprints = Record<string, Record<string, string>>;

export interface State {
  drafts: Drafts;
  fingerprints: Fingerprints;
  // locales migrate already rewrote from i18next: a later run must not read their escapes as params
  migrated?: string[];
}

export interface OutdatedEntry {
  locale: string;
  key: string;
}

// what a read-only path gets: the state, or nothing plus the reason it could not be read
export interface StateRead {
  state: State;
  problem?: string;
  // a merge left both sides in the lock: read when they parse, and the next write leaves it whole
  conflict?: true;
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

// what a save that made the lock appear, or resolved a merge conflict in it, reports once
export interface LockEntry {
  file: string;
  from?: string;
  merged?: true;
}

function statePath(cfg: ResolvedConfig): string {
  return join(cfg.root, STATE_FILE);
}

function legacyPaths(cfg: ResolvedConfig): [state: string, drafts: string] {
  return [join(cfg.dir, LEGACY_STATE_FILE), join(cfg.dir, LEGACY_DRAFTS_FILE)];
}

export function loadState(cfg: ResolvedConfig): State {
  const lock = readSides(statePath(cfg)) ?? [];
  for (const side of lock) checkVersion(statePath(cfg), side.version);
  const [legacyState = [], legacyDrafts = []] = legacyPaths(cfg).map(
    (path) => readSides(path) ?? [],
  );
  const state: State = { drafts: {}, fingerprints: {} };
  // two sides that stamped one translation differently: the one the catalog still holds stays
  const kept = lock.length > 1 ? keptStamp(cfg) : undefined;
  // the lock wins where both files know a translation; the older one only fills what it lacks
  const sources = [...lock, ...legacyState];
  sources.forEach((source, index) => {
    // drafts are joined, never dropped: a side that lost one must not approve it in the merge
    for (const [locale, keys] of Object.entries(readDrafts(source.drafts))) {
      markDrafts(state.drafts, locale, keys);
    }
    for (const [locale, stamps] of Object.entries(readFingerprints(source.fingerprints))) {
      const into = (state.fingerprints[locale] ??= emptyCatalog());
      for (const [key, stamped] of Object.entries(stamps)) {
        const held = own(into, key);
        if (held === undefined) into[key] = stamped;
        else if (index < lock.length && held !== stamped && kept?.(locale, key, stamped)) {
          into[key] = stamped;
        }
      }
    }
    const migrated = readMigrated(source.migrated);
    if (migrated) state.migrated = [...new Set([...(state.migrated ?? []), ...migrated])];
  });
  // drafts the 0.66.0 file still lists join the rest, and the next save removes that file
  for (const side of legacyDrafts) {
    for (const [locale, keys] of Object.entries(readDrafts(side))) {
      markDrafts(state.drafts, locale, keys);
    }
  }
  return state;
}

// a stamp for the translation the catalog holds now; an unreadable catalog keeps the first side
function keptStamp(cfg: ResolvedConfig): (locale: string, key: string, stamped: string) => boolean {
  const read = new Map<string, Catalog | undefined>();
  return (locale, key, stamped) => {
    if (!read.has(locale)) {
      try {
        read.set(locale, readCatalog(cfg, locale));
      } catch {
        read.set(locale, undefined);
      }
    }
    const translated = own(read.get(locale) ?? {}, key);
    return translated !== undefined && translationOf(stamped) === fingerprint(translated);
  };
}

// the file the state lives in right now: the lock, an older file next to the catalogs, or none
export function stateFile(cfg: ResolvedConfig): string | undefined {
  return [statePath(cfg), ...legacyPaths(cfg)].find((path) => existsSync(path));
}

// a write that brought the lock into being, given where the state lived before it
export function lockNews(cfg: ResolvedConfig, before: string | undefined): LockEntry | undefined {
  const lock = statePath(cfg);
  if (resolved.delete(lock)) return { file: lock, merged: true };
  if (before === lock || !existsSync(lock)) return undefined;
  return before ? { file: lock, from: before } : { file: lock };
}

// a format newer than this reader would be written back wrong: stop instead of guessing
function checkVersion(path: string, version: unknown): void {
  if (typeof version === 'number' && version > LOCK_VERSION) {
    throw new Error(
      `[verbaly] ${path} was written by a newer Verbaly (format ${version}): update @verbaly/compiler to read it`,
    );
  }
}

// read-only paths go on without the state: it only feeds warnings, never a gate they run
export function readState(cfg: ResolvedConfig): StateRead {
  const text = readText(statePath(cfg));
  const lines = text?.split(/\r?\n/) ?? [];
  const marked = lines.some((line) => CONFLICT.start.test(line)) ? { conflict: true as const } : {};
  try {
    return { state: loadState(cfg), ...marked };
  } catch (error) {
    const problem = (error as Error).message.replace(/^\[verbaly\] /, '');
    return { state: { drafts: {}, fingerprints: {} }, problem, ...marked };
  }
}

// content-compared like a catalog, and gone when there is nothing left to remember
export function saveState(cfg: ResolvedConfig, state: State): void {
  const fresh = serializeState(state);
  const path = statePath(cfg);
  const legacy = legacyPaths(cfg);
  if (fresh === undefined) {
    for (const file of [path, ...legacy]) rmSync(file, { force: true });
    return;
  }
  const existing = readText(path);
  if (existing === undefined) mkdirSync(cfg.root, { recursive: true });
  // a lock that replaces an older file keeps the line endings that file was checked out with
  const template = existing ?? legacy.map(readText).find((text) => text !== undefined);
  const serialized = withLineEndings(fresh, template);
  if (existing !== serialized) {
    if (existing !== undefined && conflictSides(existing)) resolved.add(path);
    writeFileSync(path, serialized);
  }
  // only once the lock holds everything they held
  for (const file of legacy) rmSync(file, { force: true });
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
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
  const drafts: Drafts = {};
  for (const [locale, keys] of Object.entries(previous.drafts)) {
    if (!shown.has(locale)) {
      drafts[locale] = keys;
      continue;
    }
    // a draft counts only while its translation is present: a pruned key is missing, not a draft
    const live = keys.filter((key) => own(flat[locale]!, key));
    if (live.length) drafts[locale] = live;
  }
  const fingerprints: Fingerprints = {};
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
  const out: Drafts = {};
  for (const [locale, keys] of Object.entries(drafts)) {
    const catalog = catalogs[locale] ?? {};
    const live = keys.filter((key) => own(catalog, key));
    if (live.length) out[locale] = live;
  }
  return out;
}

export function markDrafts(drafts: Drafts, locale: string, keys: string[]): void {
  if (!keys.length) return;
  drafts[locale] = [...new Set([...(drafts[locale] ?? []), ...keys])];
}

// clears specific keys, or the whole locale when keys is omitted (approve everything)
export function clearDrafts(drafts: Drafts, locale: string, keys?: string[]): void {
  if (!drafts[locale]) return;
  if (!keys) {
    delete drafts[locale];
    return;
  }
  const drop = new Set(keys);
  drafts[locale] = drafts[locale].filter((key) => !drop.has(key));
  if (!drafts[locale].length) delete drafts[locale];
}

export function fingerprint(text: string): string {
  return stableKey(text);
}

// a hash key is its own text: a new text is a new key, so its translation can never be stale
function tracked(key: string, text: string): boolean {
  return stableKey(text) !== key;
}

function stamp(source: string, translated: string): string {
  return `${fingerprint(source)}.${fingerprint(translated)}`;
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

function sourceOf(stamped: string): string {
  return stamped.slice(0, stamped.indexOf('.'));
}

function translationOf(stamped: string): string {
  return stamped.slice(stamped.indexOf('.') + 1);
}

// a caller may hand nested groups, and every key here is the dotted one t() reads
function flatCatalogs(catalogs: Catalogs): Catalogs {
  const out: Catalogs = {};
  for (const [locale, catalog] of Object.entries(catalogs)) {
    out[locale] = flatten(catalog as unknown as MessageTree);
  }
  return out;
}

function serializeState(state: State): string | undefined {
  const drafts: Drafts = {};
  for (const locale of Object.keys(state.drafts).sort()) {
    const keys = [...new Set(state.drafts[locale])].sort();
    if (keys.length) drafts[locale] = keys;
  }
  const fingerprints: Fingerprints = {};
  for (const locale of Object.keys(state.fingerprints).sort()) {
    const entries = state.fingerprints[locale] ?? {};
    const keys = Object.keys(entries).sort();
    if (!keys.length) continue;
    fingerprints[locale] = Object.fromEntries(keys.map((key) => [key, entries[key]!]));
  }
  const migrated = [...new Set(state.migrated ?? [])].sort();
  if (!Object.keys(drafts).length && !Object.keys(fingerprints).length && !migrated.length) {
    return undefined;
  }
  // what anyone who opens the file reads first, then the version an older reader checks
  const out: Record<string, unknown> = { _readme: README, version: LOCK_VERSION };
  if (Object.keys(drafts).length) out.drafts = drafts;
  if (Object.keys(fingerprints).length) out.fingerprints = fingerprints;
  if (migrated.length) out.migrated = migrated;
  return JSON.stringify(out, null, 2) + '\n';
}

// a corrupt state file throws: read as empty, the next save would erase every draft it held
function readSides(path: string): Record<string, unknown>[] | undefined {
  const content = readText(path);
  if (content === undefined) return undefined;
  const body = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const sides = conflictSides(body);
  return (sides ?? [body]).map((text) => parseObject(path, text, sides !== undefined));
}

function parseObject(path: string, text: string, conflicted: boolean): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw corrupt(path, conflicted, error);
  }
  if (!isObject(value)) throw corrupt(path, conflicted);
  return value;
}

// a merge that touched the same lines leaves both versions: each side, rebuilt, is a whole file
const CONFLICT = {
  start: /^<{7}(?: |$)/,
  base: /^\|{7}(?: |$)/,
  split: /^={7}$/,
  end: /^>{7}(?: |$)/,
};

function conflictSides(text: string): [ours: string, theirs: string] | undefined {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => CONFLICT.start.test(line))) return undefined;
  const ours: string[] = [];
  const theirs: string[] = [];
  let at: 'both' | 'ours' | 'base' | 'theirs' = 'both';
  for (const line of lines) {
    if (at === 'both' && CONFLICT.start.test(line)) at = 'ours';
    else if (at === 'ours' && CONFLICT.base.test(line)) at = 'base';
    else if ((at === 'ours' || at === 'base') && CONFLICT.split.test(line)) at = 'theirs';
    else if (at === 'theirs' && CONFLICT.end.test(line)) at = 'both';
    else if (at !== 'base') {
      if (at !== 'theirs') ours.push(line);
      if (at !== 'ours') theirs.push(line);
    }
  }
  // a marker left open is a file someone half edited, and no side of it can be trusted
  return at === 'both' ? [ours.join('\n'), theirs.join('\n')] : undefined;
}

// deleting it is the one fix that is not safe: every draft it listed would read as reviewed
function corrupt(path: string, conflicted: boolean, cause?: unknown): Error {
  return new Error(
    conflicted
      ? `[verbaly] ${path} has a merge conflict Verbaly cannot read: resolve it by hand and keep the entries of both sides (dropping a side, or the file, approves its drafts)`
      : `[verbaly] ${path} is not valid JSON: restore it from git or fix it (deleting it approves every draft)`,
    { cause },
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDrafts(value: unknown): Drafts {
  const out: Drafts = {};
  if (!isObject(value)) return out;
  for (const [locale, keys] of Object.entries(value)) {
    if (Array.isArray(keys))
      out[locale] = keys.filter((key): key is string => typeof key === 'string');
  }
  return out;
}

// absent when there is nothing to remember, like the file itself
function readMigrated(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const locales = value.filter((locale): locale is string => typeof locale === 'string');
  return locales.length ? locales : undefined;
}

function readFingerprints(value: unknown): Fingerprints {
  const out: Fingerprints = {};
  if (!isObject(value)) return out;
  for (const [locale, entries] of Object.entries(value)) {
    if (!isObject(entries)) continue;
    const kept: Record<string, string> = emptyCatalog();
    for (const [key, stamped] of Object.entries(entries)) {
      if (typeof stamped === 'string' && stamped.includes('.')) kept[key] = stamped;
    }
    out[locale] = kept;
  }
  return out;
}
