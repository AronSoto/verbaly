import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCatalog, own, type Catalogs } from './catalog';
import { targetLocales, type ResolvedConfig } from './config';
import { stableKey } from './key';

export const STATE_FILE = '.verbaly-state.json';
// before 0.67.0 the sidecar held only the drafts: read once, so an upgrade loses none of them
const LEGACY_DRAFTS_FILE = '.verbaly-drafts.json';

export type Drafts = Record<string, string[]>;

// locale -> key -> "<source>.<translation>" fingerprints from when that translation was written
export type Fingerprints = Record<string, Record<string, string>>;

export interface State {
  drafts: Drafts;
  fingerprints: Fingerprints;
}

export interface OutdatedEntry {
  locale: string;
  key: string;
}

function statePath(cfg: ResolvedConfig, file = STATE_FILE): string {
  return join(cfg.dir, file);
}

export function loadState(cfg: ResolvedConfig): State {
  const current = readJson(statePath(cfg));
  if (current !== undefined) {
    if (!isObject(current)) throw corrupt(statePath(cfg));
    return { drafts: readDrafts(current.drafts), fingerprints: readFingerprints(current.fingerprints) };
  }
  const legacy = readJson(statePath(cfg, LEGACY_DRAFTS_FILE));
  if (legacy === undefined) return { drafts: {}, fingerprints: {} };
  if (!isObject(legacy)) throw corrupt(statePath(cfg, LEGACY_DRAFTS_FILE));
  return { drafts: readDrafts(legacy), fingerprints: {} };
}

// content-compared like a catalog, and gone when there is nothing left to remember
export function saveState(cfg: ResolvedConfig, state: State): void {
  const serialized = serializeState(state);
  const path = statePath(cfg);
  const legacy = statePath(cfg, LEGACY_DRAFTS_FILE);
  if (serialized === undefined) {
    rmSync(path, { force: true });
    rmSync(legacy, { force: true });
    return;
  }
  let existing: string | undefined;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    mkdirSync(cfg.dir, { recursive: true });
  }
  if (existing !== serialized) writeFileSync(path, serialized);
  if (existsSync(legacy)) rmSync(legacy);
}

// the state follows the catalogs: drafts whose text is gone and fingerprints of dropped keys leave
export function updateState(cfg: ResolvedConfig, catalogs: Catalogs): State {
  const state = loadState(cfg);
  const next: State = {
    drafts: effectiveDrafts(state.drafts, catalogs),
    fingerprints: refreshFingerprints(cfg, catalogs, state.fingerprints),
  };
  saveState(cfg, next);
  return next;
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

// kept while only the source moves, which is the outdated signal; a new translation re-stamps it
export function refreshFingerprints(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  previous: Fingerprints,
): Fingerprints {
  const source = catalogs[cfg.sourceLocale] ?? {};
  const out: Fingerprints = {};
  for (const locale of targetLocales(cfg)) {
    const catalog = catalogs[locale] ?? {};
    const before = previous[locale] ?? {};
    const after: Record<string, string> = emptyCatalog();
    for (const [key, text] of Object.entries(source)) {
      const translated = own(catalog, key);
      if (!text || !translated || !tracked(key, text)) continue;
      const was = own(before, key);
      after[key] = was !== undefined && translationOf(was) === fingerprint(translated)
        ? was
        : stamp(text, translated);
    }
    if (Object.keys(after).length) out[locale] = after;
  }
  return out;
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
  return out.sort((a, b) => a.locale.localeCompare(b.locale) || a.key.localeCompare(b.key));
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
  const out: Partial<State> = {};
  if (Object.keys(drafts).length) out.drafts = drafts;
  if (Object.keys(fingerprints).length) out.fingerprints = fingerprints;
  if (!out.drafts && !out.fingerprints) return undefined;
  return JSON.stringify(out, null, 2) + '\n';
}

// a corrupt sidecar throws: read as empty, the next save would erase every draft it held
function readJson(path: string): unknown {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content) as unknown;
  } catch (error) {
    throw corrupt(path, error);
  }
}

function corrupt(path: string, cause?: unknown): Error {
  return new Error(`[verbaly] ${path} is not valid JSON, fix or delete the file`, { cause });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readDrafts(value: unknown): Drafts {
  const out: Drafts = {};
  if (!isObject(value)) return out;
  for (const [locale, keys] of Object.entries(value)) {
    if (Array.isArray(keys)) out[locale] = keys.filter((key): key is string => typeof key === 'string');
  }
  return out;
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
