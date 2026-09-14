import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import {
  check,
  clearDrafts,
  collectOrigins,
  doctor,
  effectiveDrafts,
  extractProject,
  loadDrafts,
  markDrafts,
  readCatalog,
  saveDrafts,
  status,
  targetLocales,
  validateMessage,
  validatePair,
  writeCatalog,
} from '@verbaly/compiler';
import { DRAFTS_FILE } from '@verbaly/compiler';
import type {
  Catalog,
  Catalogs,
  CheckResult,
  DoctorResult,
  Drafts,
  ResolvedConfig,
  StatusResult,
} from '@verbaly/compiler';
import { badRequest } from './http';
import { triage, type TriageResult } from './triage';

export interface StudioProblem {
  scope: string;
  message: string;
}

export interface StudioState {
  root: string;
  dir: string;
  sourceLocale: string;
  locales: string[];
  scanning: boolean;
  catalogs: Catalogs;
  origins: Record<string, string[]>;
  status: StatusResult;
  check: CheckResult;
  drafts: Drafts;
  triage: Record<string, TriageResult>;
  problems: StudioProblem[];
}

// A locale nobody can parse must not take the panel down: Studio is what you open to fix it.
function readAll(cfg: ResolvedConfig): { catalogs: Catalogs; problems: StudioProblem[] } {
  const catalogs: Catalogs = {};
  const problems: StudioProblem[] = [];
  // an empty green panel and a wrong --root look identical, and only this line tells them apart
  if (!existsSync(cfg.dir)) {
    const dir = relative(cfg.root, cfg.dir).replaceAll('\\', '/');
    problems.push({ scope: dir, message: '[verbaly] no catalogs here, run npx verbaly init or check --root' });
  }
  for (const locale of cfg.locales) {
    try {
      catalogs[locale] = readCatalog(cfg, locale);
    } catch (error) {
      catalogs[locale] = {};
      problems.push({
        scope: locale,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { catalogs, problems };
}

// A sidecar nobody can parse is the other file Studio exists to fix, so it degrades like a catalog.
function readDrafts(cfg: ResolvedConfig): { drafts: Drafts; problems: StudioProblem[] } {
  try {
    return { drafts: loadDrafts(cfg), problems: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { drafts: {}, problems: [{ scope: DRAFTS_FILE, message }] };
  }
}

// check() reports the file a stray key was used in as an absolute path, origins already do not.
function relativize(cfg: ResolvedConfig, result: CheckResult): CheckResult {
  return {
    ...result,
    unknown: result.unknown.map((entry) => ({
      ...entry,
      files: entry.files.map((file) => relative(cfg.root, file).replaceAll('\\', '/')),
    })),
  };
}

// One shot and unpaginated: the biggest catalog we know is 1587 messages, instant over localhost.
export async function buildState(cfg: ResolvedConfig): Promise<StudioState> {
  const { catalogs, problems } = readAll(cfg);
  const registry = await extractProject(cfg);
  const sidecar = readDrafts(cfg);
  problems.push(...sidecar.problems);
  const live = effectiveDrafts(sidecar.drafts, catalogs);
  const source = (catalogs[cfg.sourceLocale] ?? {}) as Catalog;
  const targets = targetLocales(cfg);

  for (const { file, message } of registry.parseErrors()) {
    problems.push({ scope: relative(cfg.root, file).replaceAll('\\', '/'), message });
  }

  const perLocale: Record<string, TriageResult> = {};
  for (const locale of targets) {
    perLocale[locale] = triage({
      source,
      target: (catalogs[locale] ?? {}) as Catalog,
      // a locale still carrying drafts has not been reviewed, so it cannot be the control
      reviewed: targets
        .filter((other) => other !== locale && !(live[other] ?? []).length)
        .map((other) => (catalogs[other] ?? {}) as Catalog),
    });
  }

  return {
    root: cfg.root,
    dir: cfg.dir,
    sourceLocale: cfg.sourceLocale,
    locales: cfg.locales,
    // with include: [] nothing is scanned, so an empty origins map is off, not "none found"
    scanning: cfg.include.length > 0,
    catalogs,
    origins: await collectOrigins(cfg, registry),
    status: status(cfg, catalogs, registry, live),
    check: relativize(cfg, check(cfg, catalogs, registry)),
    drafts: live,
    triage: perLocale,
    problems,
  };
}

export function health(cfg: ResolvedConfig): Promise<DoctorResult> {
  return doctor(cfg);
}

export interface WriteMessageResult {
  locale: string;
  key: string;
  clearedDraft: boolean;
}

// A human wrote it, so it is reviewed: the rule import already applies in run.ts:447.
export function writeMessage(
  cfg: ResolvedConfig,
  locale: string,
  key: string,
  text: string,
): WriteMessageResult {
  if (locale === cfg.sourceLocale) {
    throw badRequest('the source text lives in your code, Studio never edits it');
  }
  if (!cfg.locales.includes(locale)) {
    throw badRequest(`${locale} is not one of this project's locales`);
  }
  const source = readCatalog(cfg, cfg.sourceLocale);
  // hasOwn, not `in`: `in` walks the prototype, so toString and __proto__ would pass this guard
  if (!Object.hasOwn(source, key)) {
    throw badRequest(`"${key}" is not in the source catalog, so Studio will not create it`);
  }
  // '' is untranslated everywhere else, so whitespace is that and not a translation to validate
  const value = text.trim() ? text : '';
  // the same two calls check() makes: validatePair alone misses a plural block with no other case
  const issues = value
    ? [...validateMessage(value, locale), ...validatePair(source[key] as string, value)]
    : [];
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    throw badRequest(`${errors.map((issue) => issue.message).join('; ')}`);
  }

  const catalog = { ...readCatalog(cfg, locale), [key]: value };
  writeCatalog(cfg, locale, catalog);

  const drafts = loadDrafts(cfg);
  const clearedDraft = (drafts[locale] ?? []).includes(key);
  clearDrafts(drafts, locale, [key]);
  saveDrafts(cfg, drafts);
  return { locale, key, clearedDraft };
}

export interface ApproveResult {
  locale: string;
  approved: number;
  keys: string[];
}

// The sidecar is re-read here: saveDrafts writes every locale, so a stale copy drops another's.
export function approve(cfg: ResolvedConfig, locale: string, keys?: string[]): ApproveResult {
  if (!cfg.locales.includes(locale)) {
    throw badRequest(`${locale} is not one of this project's locales`);
  }
  const drafts = loadDrafts(cfg);
  const had = drafts[locale] ?? [];
  // the keys it really cleared, because undo has to put back exactly those and nothing else
  const cleared = keys ? had.filter((key) => keys.includes(key)) : [...had];
  clearDrafts(drafts, locale, keys);
  saveDrafts(cfg, drafts);
  return { locale, approved: cleared.length, keys: cleared };
}

// Undo is not a nicety here: the flag records who wrote the text, so restoring it restores a fact.
export function unapprove(cfg: ResolvedConfig, locale: string, keys: string[]): ApproveResult {
  if (!cfg.locales.includes(locale)) {
    throw badRequest(`${locale} is not one of this project's locales`);
  }
  const drafts = loadDrafts(cfg);
  markDrafts(drafts, locale, keys);
  saveDrafts(cfg, drafts);
  return { locale, approved: keys.length, keys };
}
