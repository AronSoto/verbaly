import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripBom } from '../util/text';
import { emptyCatalog, isRecord, own, readCatalog, type Catalog } from './catalog';
import type { ResolvedConfig } from '../config/config';
import { withLineEndings } from '../util/eol';
import { stableKey } from '../util/key';

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

// what a read-only path gets: the state, or nothing plus the reason it could not be read
export interface StateRead {
  state: State;
  problem?: string;
  // a merge left both sides in the lock: read when they parse, and the next write leaves it whole
  conflict?: true;
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
  const state: State = { drafts: emptyCatalog(), fingerprints: emptyCatalog() };
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
    return { state: { drafts: emptyCatalog(), fingerprints: emptyCatalog() }, problem, ...marked };
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

export function stamp(source: string, translated: string): string {
  return `${fingerprint(source)}.${fingerprint(translated)}`;
}

export function sourceOf(stamped: string): string {
  return stamped.slice(0, stamped.indexOf('.'));
}

export function translationOf(stamped: string): string {
  return stamped.slice(stamped.indexOf('.') + 1);
}

function serializeState(state: State): string | undefined {
  const drafts: Drafts = emptyCatalog();
  for (const locale of Object.keys(state.drafts).sort()) {
    const keys = [...new Set(state.drafts[locale])].sort();
    if (keys.length) drafts[locale] = keys;
  }
  const fingerprints: Fingerprints = emptyCatalog();
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
  const body = stripBom(content);
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
  if (!isRecord(value)) throw corrupt(path, conflicted);
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

function readDrafts(value: unknown): Drafts {
  const out: Drafts = emptyCatalog();
  if (!isRecord(value)) return out;
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
  const out: Fingerprints = emptyCatalog();
  if (!isRecord(value)) return out;
  for (const [locale, entries] of Object.entries(value)) {
    if (!isRecord(entries)) continue;
    const kept: Record<string, string> = emptyCatalog();
    for (const [key, stamped] of Object.entries(entries)) {
      if (typeof stamped === 'string' && stamped.includes('.')) kept[key] = stamped;
    }
    out[locale] = kept;
  }
  return out;
}
