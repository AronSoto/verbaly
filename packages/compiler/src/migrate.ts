import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog } from './catalog';
import { catalogPath, emptyCatalog, readCatalog, writeCatalog } from './catalog';
import type { ResolvedConfig } from './config';
import { loadState, saveState } from './state';

export interface MigrateBrace {
  locale: string;
  key: string;
  before: string;
  after: string;
}

export interface MigratePlural {
  locale: string;
  key: string;
  from: string[];
  after: string;
}

export interface MigrateSkip {
  locale: string;
  key: string;
  reason: string;
}

export interface MigrateResult {
  detected: string[];
  braces: MigrateBrace[];
  plurals: MigratePlural[];
  skipped: MigrateSkip[];
  written: string[];
  // converted by an earlier --write: their braces are Verbaly's now and stay as they are
  remembered: string[];
}

export interface MigrateOptions {
  write?: boolean;
  plurals?: boolean;
}

// The libraries whose catalogs this understands; the name is what the report shows.
const KNOWN = ['i18next', 'react-i18next', 'vue-i18n', 'react-intl', 'next-intl', 'svelte-i18n'];

export function detectLibraries(root: string): string[] {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return [];
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  return KNOWN.filter((name) => deps[name] !== undefined);
}

// i18next writes a format and an unescape inside the braces, and neither maps one to one.
const PLAIN = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}/g;
const FORMATTED = /\{\{\s*-?\s*[A-Za-z_$][\w$]*\s*,[^}]*\}\}/;
const UNESCAPED = /\{\{\s*-\s*[A-Za-z_$][\w$]*\s*\}\}/;
const NESTED = /\$t\(/;
// any {{…}} is i18next's syntax: a catalog with none says nothing about whose braces it holds
const DOUBLE = /\{\{[^{}]*\}\}/;
const DOUBLES = new RegExp(DOUBLE.source, 'g');
const ONE_PLAIN = new RegExp(`^${PLAIN.source}$`);
const NAME = /^\s*([A-Za-z_$][\w$]*)\s*$/;

// Everything i18next has ever suffixed a plural with, newest spelling first.
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const SUFFIX = new RegExp(`^(.*)_(${[...CATEGORIES, 'plural'].join('|')})$`);

// what a value uses that has no one-to-one Verbaly form, so a person decides it
function i18nextProblem(text: string): string | undefined {
  if (NESTED.test(text)) return 'uses $t() nesting, which has no direct equivalent';
  if (UNESCAPED.test(text)) return 'uses {{- name}}, so decide whether the message is rich';
  if (FORMATTED.test(text)) return 'uses an i18next format, which needs the matching Verbaly one';
  for (const [double] of text.matchAll(DOUBLES)) {
    if (!ONE_PLAIN.test(double))
      return 'uses {{…}} with more than a name, which needs a Verbaly param';
  }
  return undefined;
}

// i18next reads {{name}} as a param and a lone brace as text; Verbaly reads both the other way
function convertBraces(text: string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(PLAIN)) {
    out += escapeBraces(text.slice(last, match.index)) + `{${match[1]}}`;
    last = match.index + match[0].length;
  }
  return out + escapeBraces(text.slice(last));
}

function escapeBraces(text: string): string {
  return text.replace(/[{}]/g, (brace) => brace + brace);
}

// a form becomes a case of a block, where # prints the count and a lone | or } would end it
function toVariant(text: string): string | undefined {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if ((ch === '{' || ch === '}') && text[i + 1] === ch) {
      out += ch + ch;
      i += 2;
    } else if (ch === '{') {
      const close = text.indexOf('}', i);
      const name = close < 0 ? undefined : NAME.exec(text.slice(i + 1, close))?.[1];
      // a block inside a form would nest blind: that one is merged by hand
      if (name === undefined) return undefined;
      out += name === 'count' ? '#' : `{${name}}`;
      i = close + 1;
    } else {
      out += ch === '#' || ch === '|' || ch === '}' ? ch + ch : ch;
      i += 1;
    }
  }
  return out;
}

function order(a: string, b: string): number {
  return CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b);
}

function mergePlurals(
  locale: string,
  catalog: Catalog,
  out: Catalog,
  plurals: MigratePlural[],
  skipped: MigrateSkip[],
  fromI18next: boolean,
): void {
  // the original key rides along: _plural and _other both mean "other", and only one of them exists
  const groups = new Map<string, Map<string, { key: string; value: string }>>();
  const legacy = new Set<string>();
  for (const [key, value] of Object.entries(catalog)) {
    const match = SUFFIX.exec(key);
    if (!match || typeof value !== 'string') continue;
    const [, base, suffix] = match;
    if (suffix === 'plural') legacy.add(base!);
    const category = suffix === 'plural' ? 'other' : suffix!;
    if (!groups.has(base!)) groups.set(base!, new Map());
    groups.get(base!)!.set(category, { key, value });
  }

  for (const [base, forms] of groups) {
    const bare = catalog[base];
    // i18next before v21 spelled the pair `key` + `key_plural`, so the bare key is the singular
    if (legacy.has(base) && typeof bare === 'string' && !forms.has('one')) {
      forms.set('one', { key: base, value: bare });
    } else if (bare !== undefined) {
      skipped.push({ locale, key: base, reason: `"${base}" already exists, so merging would overwrite it` });
      continue;
    }
    if (!forms.has('other')) {
      skipped.push({ locale, key: base, reason: 'no _other form, so the block would have no catch-all' });
      continue;
    }
    // one form is not a plural: merging it would render the plural wording for a count of one
    if (forms.size === 1) {
      skipped.push({ locale, key: base, reason: 'only a plural form, so add the singular before merging' });
      continue;
    }
    const sorted = [...forms.entries()].sort((a, b) => order(a[0], b[0]));
    const cases: string[] = [];
    let problem: string | undefined;
    for (const [category, form] of sorted) {
      problem = fromI18next ? i18nextProblem(form.value) : undefined;
      const body = problem
        ? undefined
        : toVariant(fromI18next ? convertBraces(form.value) : form.value);
      if (body === undefined) {
        problem ??= 'a form holds more than a name in braces, so merge it by hand';
        break;
      }
      cases.push(`${category}: ${body}`);
    }
    if (problem) {
      skipped.push({ locale, key: base, reason: problem });
      continue;
    }
    const merged = `{count | ${cases.join(' | ')}}`;
    for (const [, form] of sorted) delete out[form.key];
    out[base] = merged;
    plurals.push({ locale, key: base, from: sorted.map(([, form]) => form.key), after: merged });
  }
}

// Catalogs only: the code side is `verbaly wrap` and a hook swap, and neither is mechanical here.
export function migrateCatalogs(cfg: ResolvedConfig, options: MigrateOptions = {}): MigrateResult {
  const braces: MigrateBrace[] = [];
  const plurals: MigratePlural[] = [];
  const skipped: MigrateSkip[] = [];
  const written: string[] = [];
  const state = loadState(cfg);
  const done = new Set(state.migrated ?? []);
  const catalogs = new Map(cfg.locales.map((locale) => [locale, readCatalog(cfg, locale)]));
  const pending = cfg.locales.filter((locale) => !done.has(locale));
  // a lone brace is text to i18next and a param to Verbaly: only i18next's {{…}} says whose it is
  const fromI18next = pending.some((locale) =>
    Object.values(catalogs.get(locale)!).some(
      (value) => typeof value === 'string' && (DOUBLE.test(value) || NESTED.test(value)),
    ),
  );

  for (const locale of cfg.locales) {
    const catalog = catalogs.get(locale)!;
    const out: Catalog = Object.assign(emptyCatalog(), catalog);
    const convert = fromI18next && !done.has(locale);

    for (const [key, value] of Object.entries(catalog)) {
      if (!convert || typeof value !== 'string') continue;
      const problem = i18nextProblem(value);
      if (problem) {
        skipped.push({ locale, key, reason: problem });
        continue;
      }
      const after = convertBraces(value);
      if (after !== value) {
        braces.push({ locale, key, before: value, after });
        out[key] = after;
      }
    }

    if (options.plurals) mergePlurals(locale, catalog, out, plurals, skipped, convert);

    const changed = braces.some((b) => b.locale === locale) || plurals.some((p) => p.locale === locale);
    if (changed && options.write) {
      writeCatalog(cfg, locale, out);
      written.push(locale);
    }
  }

  // remembered once written: a later run would read every escape it wrote as an i18next param
  if (options.write && fromI18next) {
    const converted = pending.filter((locale) => existsSync(catalogPath(cfg, locale)));
    if (converted.length) saveState(cfg, { ...state, migrated: [...done, ...converted] });
  }

  const remembered = cfg.locales.filter((locale) => done.has(locale));
  return { detected: detectLibraries(cfg.root), braces, plurals, skipped, written, remembered };
}
