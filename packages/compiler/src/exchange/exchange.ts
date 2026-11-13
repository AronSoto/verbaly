import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { emptyCatalog, own, type Catalogs } from '../catalog/catalog';
import { targetLocales, type ResolvedConfig } from '../config/config';
import { androidValuesDir, toAndroidXml, toIosStrings } from './mobile';
import { parseCsv, toCsv } from './csv';
import { parsePo, toPo } from './po';
import { parseXliff, toXliff } from './xliff';
import { isLocaleTag, projectLocale, suggestTag } from '../util/tag';
import { structureMatches } from '../gate/validate';

export type ExchangeFormat = 'xliff' | 'csv' | 'po';
export type MobileFormat = 'android-xml' | 'ios-strings';
export type ExportFormat = ExchangeFormat | MobileFormat;

export function isMobileFormat(format: ExportFormat): format is MobileFormat {
  return format === 'android-xml' || format === 'ios-strings';
}

export interface ExportOptions {
  locales?: string[];
  format?: ExportFormat;
  out?: string;
  missing?: boolean;
  origins?: Record<string, string[]>;
}

export interface ExportedFile {
  locale: string;
  path: string;
  total: number;
  untranslated: number;
}

export interface ExportResult {
  format: ExportFormat;
  dir: string;
  files: ExportedFile[];
}

export interface ImportOptions {
  locale?: string;
  overwrite?: boolean;
  dryRun?: boolean;
}

export interface ImportResult {
  imported: Record<string, string[]>;
  rejected: Record<string, string[]>;
  skipped: Record<string, string[]>;
  unknown: Record<string, string[]>;
  unmatched: { file: string; locale: string; reason: 'undeclared' | 'invalid' }[];
  mapped: { file: string; from: string; to: string }[];
  sources: Record<string, Record<string, string>>;
}

// One file per target locale: source text + current translation
export function exportCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  options: ExportOptions = {},
): ExportResult {
  const format = options.format ?? 'xliff';
  const dir = resolve(cfg.root, options.out ?? 'verbaly-export');
  const source = catalogs[cfg.sourceLocale] ?? emptyCatalog();
  const targets = targetLocales(cfg, options.locales);
  if (isMobileFormat(format)) {
    return exportMobile(cfg, catalogs, format, dir, source, targets);
  }

  const files: ExportedFile[] = [];
  const origins = options.origins;
  mkdirSync(dir, { recursive: true });
  for (const locale of targets) {
    const catalog = catalogs[locale] ?? emptyCatalog();
    const all = translatable(source).map((key) => ({
      key,
      source: source[key]!,
      target: own(catalog, key) ?? '',
      // own entries: a key named constructor would find Object's function and crash the writer
      location: origins && Object.hasOwn(origins, key) ? origins[key] : undefined,
    }));
    const untranslated = all.filter((entry) => !entry.target);
    const entries = options.missing ? untranslated : all;

    const ext = format === 'xliff' ? 'xlf' : format;
    const path = join(dir, `${locale}.${ext}`);
    const content =
      format === 'csv'
        ? toCsv(entries)
        : format === 'po'
          ? toPo(cfg.sourceLocale, locale, entries)
          : toXliff(cfg.sourceLocale, locale, entries);
    writeFileSync(path, content);
    files.push({
      locale,
      path,
      total: entries.length,
      untranslated: untranslated.length,
    });
  }
  return { format, dir, files };
}

// every key of the source that has a text, in the order every export writes them
function translatable(source: Readonly<Record<string, string>>): string[] {
  return Object.keys(source)
    .filter((key) => source[key])
    .sort();
}

// native resources: source locale is the platform default, untranslated keys are skipped
function exportMobile(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  format: MobileFormat,
  dir: string,
  source: Record<string, string>,
  targets: string[],
): ExportResult {
  const keys = translatable(source);
  const files: ExportedFile[] = [];
  for (const locale of [cfg.sourceLocale, ...targets]) {
    const catalog = locale === cfg.sourceLocale ? source : (catalogs[locale] ?? emptyCatalog());
    const entries = keys
      .map((key) => ({ key, text: own(catalog, key) ?? '' }))
      .filter((entry) => entry.text);
    const relative =
      format === 'android-xml'
        ? join(androidValuesDir(locale, cfg.sourceLocale), 'strings.xml')
        : join(`${locale}.lproj`, 'Localizable.strings');
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, format === 'android-xml' ? toAndroidXml(entries) : toIosStrings(entries));
    files.push({
      locale,
      path,
      total: entries.length,
      untranslated: keys.length - entries.length,
    });
  }
  return { format, dir, files };
}

// fills catalogs from translated files
export function importCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  files: string[],
  options: ImportOptions = {},
): ImportResult {
  const source = catalogs[cfg.sourceLocale] ?? emptyCatalog();
  const result: ImportResult = {
    imported: emptyCatalog(),
    rejected: emptyCatalog(),
    skipped: emptyCatalog(),
    unknown: emptyCatalog(),
    unmatched: [],
    mapped: [],
    sources: emptyCatalog(),
  };

  for (const file of files) {
    const parsed = parseExchangeFile(file, options.locale);
    const detected = parsed.locale;
    if (!/^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]+)*$/.test(detected)) {
      throw new Error(
        `[verbaly] ${file}: "${detected}" doesn't look like a locale, pass --locale <id>`,
      );
    }
    const locale = projectLocale(detected, cfg.locales) ?? newLocale(cfg, detected);
    if (locale === cfg.sourceLocale) {
      throw new Error(
        `[verbaly] ${file} targets the source locale "${locale}": import fills translations, not the source, so pass --locale if the detection is wrong`,
      );
    }
    // a pt_BR catalog next to pt-BR, or one a declared list never loads, is a language nobody sees
    if (locale === undefined) {
      const near = isLocaleTag(detected) ? detected : suggestTag(detected);
      result.unmatched.push(
        near
          ? { file, locale: near, reason: 'undeclared' }
          : { file, locale: detected, reason: 'invalid' },
      );
      continue;
    }
    if (locale !== detected) result.mapped.push({ file, from: detected, to: locale });
    const catalog = (catalogs[locale] ??= emptyCatalog());
    for (const [key, text] of Object.entries(parsed.entries)) {
      if (!text.trim()) continue;
      const from = own(source, key);
      if (!from) {
        (result.unknown[locale] ??= []).push(key);
        continue;
      }
      if (own(catalog, key) && !options.overwrite) {
        (result.skipped[locale] ??= []).push(key);
        continue;
      }
      if (!structureMatches(from, text)) {
        (result.rejected[locale] ??= []).push(key);
        continue;
      }
      if (!options.dryRun) catalog[key] = text;
      (result.imported[locale] ??= []).push(key);
      const seen = parsed.sources[key];
      if (seen) (result.sources[locale] ??= emptyCatalog())[key] = seen;
    }
  }
  return result;
}

export interface ExchangeEntry {
  key: string;
  source: string;
  target: string;
  location?: string[];
}

interface ParsedFile {
  locale: string;
  entries: Record<string, string>;
  // the source text the translator saw, when the format carries one
  sources: Record<string, string>;
}

export function parseExchangeFile(file: string, localeOverride?: string): ParsedFile {
  const content = readFileSync(file, 'utf8');
  if (/\.(xlf|xliff)$/i.test(file)) {
    const parsed = parseXliff(content);
    const locale = localeOverride ?? parsed.locale;
    if (!locale) {
      throw new Error(`[verbaly] ${file} has no trgLang/target-language, pass --locale <id>`);
    }
    return { locale, entries: parsed.entries, sources: parsed.sources };
  }
  if (/\.csv$/i.test(file)) {
    const locale = localeOverride ?? basename(file).replace(/\.csv$/i, '');
    return { locale, ...parseCsv(content) };
  }
  if (/\.po$/i.test(file)) {
    const parsed = parsePo(content);
    const locale = localeOverride ?? parsed.locale ?? basename(file).replace(/\.po$/i, '');
    return { locale, entries: parsed.entries, sources: parsed.sources };
  }
  throw new Error(`[verbaly] ${file}: unsupported format, expected .xlf, .xliff, .csv or .po`);
}

// with no list written down, a language exists by having a catalog, so a file may start one
function newLocale(cfg: ResolvedConfig, detected: string): string | undefined {
  if (cfg.localesDeclared) return undefined;
  return isLocaleTag(detected) ? detected : suggestTag(detected);
}
