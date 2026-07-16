import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Catalogs } from './catalog';
import { targetLocales, type ResolvedConfig } from './config';
import { androidValuesDir, toAndroidXml, toIosStrings } from './mobile';
import { structureMatches } from './translate';

export type ExchangeFormat = 'xliff' | 'csv';
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
}

// One file per target locale: source text + current translation
export function exportCatalogs(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  options: ExportOptions = {},
): ExportResult {
  const format = options.format ?? 'xliff';
  const dir = resolve(cfg.root, options.out ?? 'verbaly-export');
  const source = catalogs[cfg.sourceLocale] ?? {};
  const targets = targetLocales(cfg, options.locales);
  if (isMobileFormat(format)) {
    return exportMobile(cfg, catalogs, format, dir, source, targets);
  }

  const files: ExportedFile[] = [];
  mkdirSync(dir, { recursive: true });
  for (const locale of targets) {
    const catalog = catalogs[locale] ?? {};
    const all = Object.keys(source)
      .filter((key) => source[key])
      .sort()
      .map((key) => ({ key, source: source[key]!, target: catalog[key] ?? '' }));
    const untranslated = all.filter((entry) => !entry.target);
    const entries = options.missing ? untranslated : all;

    const path = join(dir, `${locale}.${format === 'csv' ? 'csv' : 'xlf'}`);
    const content = format === 'csv' ? toCsv(entries) : toXliff(cfg.sourceLocale, locale, entries);
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

// drop-in native resources (res/values-*, *.lproj); the source locale ships as the default,
// untranslated keys are skipped so the platform falls back to it
function exportMobile(
  cfg: ResolvedConfig,
  catalogs: Catalogs,
  format: MobileFormat,
  dir: string,
  source: Record<string, string>,
  targets: string[],
): ExportResult {
  const keys = Object.keys(source)
    .filter((key) => source[key])
    .sort();
  const files: ExportedFile[] = [];
  for (const locale of [cfg.sourceLocale, ...targets]) {
    const catalog = locale === cfg.sourceLocale ? source : (catalogs[locale] ?? {});
    const entries = keys
      .map((key) => ({ key, text: catalog[key] ?? '' }))
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
  const source = catalogs[cfg.sourceLocale] ?? {};
  const result: ImportResult = { imported: {}, rejected: {}, skipped: {}, unknown: {} };

  for (const file of files) {
    const parsed = parseExchangeFile(file, options.locale);
    const locale = parsed.locale;
    if (!/^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]+)*$/.test(locale)) {
      throw new Error(
        `[verbaly] ${file}: "${locale}" doesn't look like a locale, pass --locale <id>.`,
      );
    }
    if (locale === cfg.sourceLocale) {
      throw new Error(
        `[verbaly] ${file} targets the source locale "${locale}": import fills translations, not the source. Pass --locale if the detection is wrong.`,
      );
    }
    const catalog = (catalogs[locale] ??= {});
    for (const [key, text] of Object.entries(parsed.entries)) {
      if (!text.trim()) continue;
      if (!source[key]) {
        (result.unknown[locale] ??= []).push(key);
        continue;
      }
      if (catalog[key] && !options.overwrite) {
        (result.skipped[locale] ??= []).push(key);
        continue;
      }
      if (!structureMatches(source[key], text)) {
        (result.rejected[locale] ??= []).push(key);
        continue;
      }
      if (!options.dryRun) catalog[key] = text;
      (result.imported[locale] ??= []).push(key);
    }
  }
  return result;
}

interface ExchangeEntry {
  key: string;
  source: string;
  target: string;
}

interface ParsedFile {
  locale: string;
  entries: Record<string, string>;
}

export function parseExchangeFile(file: string, localeOverride?: string): ParsedFile {
  const content = readFileSync(file, 'utf8');
  if (/\.(xlf|xliff)$/i.test(file)) {
    const parsed = parseXliff(content);
    const locale = localeOverride ?? parsed.locale;
    if (!locale) {
      throw new Error(`[verbaly] ${file} has no trgLang/target-language, pass --locale <id>.`);
    }
    return { locale, entries: parsed.entries };
  }
  if (/\.csv$/i.test(file)) {
    const locale = localeOverride ?? basename(file).replace(/\.csv$/i, '');
    return { locale, entries: parseCsv(content) };
  }
  throw new Error(`[verbaly] ${file}: unsupported format, expected .xlf, .xliff or .csv.`);
}

// XLIFF 2.0 (writes) / 2.0 + 1.2 (reads)
function toXliff(sourceLocale: string, locale: string, entries: ExchangeEntry[]): string {
  const units = entries
    .map(({ key, source, target }) =>
      [
        `    <unit id="${escapeXml(key)}">`,
        `      <segment state="${target ? 'translated' : 'initial'}">`,
        `        <source>${escapeXml(source)}</source>`,
        `        <target>${escapeXml(target)}</target>`,
        '      </segment>',
        '    </unit>',
      ].join('\n'),
    )
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${escapeXml(sourceLocale)}" trgLang="${escapeXml(locale)}">`,
    `  <file id="verbaly" original="${escapeXml(`${locale}.json`)}">`,
    units,
    '  </file>',
    '</xliff>',
    '',
  ].join('\n');
}

function parseXliff(content: string): { locale?: string; entries: Record<string, string> } {
  const locale =
    /\btrgLang\s*=\s*"([^"]+)"/.exec(content)?.[1] ??
    /\btarget-language\s*=\s*"([^"]+)"/.exec(content)?.[1];
  const entries: Record<string, string> = {};
  const UNIT = /<(?:trans-)?unit\b([^>]*)>([\s\S]*?)<\/(?:trans-)?unit>/g;
  for (const match of content.matchAll(UNIT)) {
    const id = /\bid\s*=\s*"([^"]*)"/.exec(match[1]!)?.[1];
    if (!id) continue;
    const target = /<target\b[^>]*>([\s\S]*?)<\/target>/.exec(match[2]!)?.[1];
    entries[unescapeXml(id)] = target === undefined ? '' : unescapeXml(stripCdata(target));
  }
  return { locale, entries };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, (_, entity: string) => {
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'amp') return '&';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const code = entity.startsWith('#x')
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

// CSV (RFC 4180)
function toCsv(entries: ExchangeEntry[]): string {
  const rows = entries.map(
    ({ key, source, target }) => `${csvField(key)},${csvField(source)},${csvField(target)}`,
  );
  return ['key,source,target', ...rows, ''].join('\r\n');
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(content: string): Record<string, string> {
  const rows = csvRows(content);
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const keyCol = header.indexOf('key');
  const targetCol = header.indexOf('target');
  if (keyCol === -1 || targetCol === -1) {
    throw new Error('[verbaly] CSV needs a header row with "key" and "target" columns.');
  }
  const entries: Record<string, string> = {};
  for (const row of rows.slice(1)) {
    const key = row[keyCol];
    if (key) entries[key] = row[targetCol] ?? '';
  }
  return entries;
}

function csvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (quoted) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}
