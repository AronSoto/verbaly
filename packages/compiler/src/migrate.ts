import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Catalog } from './catalog';
import { readCatalog, writeCatalog } from './catalog';
import type { ResolvedConfig } from './config';

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

// Everything i18next has ever suffixed a plural with, newest spelling first.
const CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const SUFFIX = new RegExp(`^(.*)_(${[...CATEGORIES, 'plural'].join('|')})$`);

function convertBraces(text: string): string {
  return text.replace(PLAIN, '{$1}');
}

// Inside a variant the count prints itself localized, which is the whole point of merging.
function toHash(text: string): string {
  return text.replaceAll('{count}', '#');
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
    const cases = sorted.map(([category, form]) => `${category}: ${toHash(convertBraces(form.value))}`);
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

  for (const locale of cfg.locales) {
    const catalog = readCatalog(cfg, locale);
    const out: Catalog = { ...catalog };

    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== 'string') continue;
      if (NESTED.test(value)) {
        skipped.push({ locale, key, reason: 'uses $t() nesting, which has no direct equivalent' });
        continue;
      }
      if (UNESCAPED.test(value)) {
        skipped.push({ locale, key, reason: 'uses {{- name}}, so decide whether the message is rich' });
        continue;
      }
      if (FORMATTED.test(value)) {
        skipped.push({ locale, key, reason: 'uses an i18next format, which needs the matching Verbaly one' });
        continue;
      }
      const after = convertBraces(value);
      if (after !== value) {
        braces.push({ locale, key, before: value, after });
        out[key] = after;
      }
    }

    if (options.plurals) mergePlurals(locale, catalog, out, plurals, skipped);

    const changed = braces.some((b) => b.locale === locale) || plurals.some((p) => p.locale === locale);
    if (changed && options.write) {
      writeCatalog(cfg, locale, out);
      written.push(locale);
    }
  }

  return { detected: detectLibraries(cfg.root), braces, plurals, skipped, written };
}
