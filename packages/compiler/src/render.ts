import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import MagicString from 'magic-string';
import { glob } from 'tinyglobby';
import { createVerbaly, parseTags, RICH_TAGS, type Params, type TagNode } from 'verbaly';
import type { Catalogs } from './catalog';
import { loadCatalogs } from './catalog';
import type { ResolvedConfig } from './config';

export interface RenderHtmlOptions {
  locale: string;
  catalogs: Catalogs;
  sourceLocale?: string;
  attribute?: string;
  richTags?: string[];
  setLang?: boolean;
}

export interface RenderHtmlResult {
  html: string;
  missing: string[];
}

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// pre-fills data-verbaly elements for one locale; the runtime stays functional
export function renderHtml(html: string, options: RenderHtmlOptions): RenderHtmlResult {
  const attr = options.attribute ?? 'data-verbaly';
  const argsAttr = `${attr}-args`;
  const attrsAttr = `${attr}-attr`;
  const richAttr = `${attr}-rich`;
  const richTags = new Set(options.richTags ?? RICH_TAGS);
  const sourceLocale = options.sourceLocale ?? 'en';

  // '' entries count as untranslated → fall back
  const messages: Record<string, Record<string, string>> = {};
  for (const [locale, catalog] of Object.entries(options.catalogs)) {
    const clean: Record<string, string> = {};
    for (const [key, msg] of Object.entries(catalog)) if (msg) clean[key] = msg;
    messages[locale] = clean;
  }
  const v = createVerbaly({ locale: options.locale, fallback: sourceLocale, messages });
  const t = v.t as unknown as (key: string, params?: Params) => string;

  const ms = new MagicString(html);
  const missing = new Set<string>();
  const skip = protectedRanges(html);
  const inSkip = (index: number): boolean =>
    skip.some(([from, to]) => index >= from && index < to);

  START_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START_TAG.exec(html)) !== null) {
    if (inSkip(m.index)) continue;
    const [full, rawName, attrChunk] = m as unknown as [string, string, string];
    const tagName = rawName.toLowerCase();
    const openEnd = m.index + full.length;

    const chunkStart = m.index + 1 + rawName.length;

    if (tagName === 'html' && options.setLang !== false) {
      setAttribute(ms, html, chunkStart, openEnd, attrChunk, 'lang', options.locale);
      continue;
    }

    const attrs = parseAttrs(attrChunk);
    const key = attrs.get(attr);
    const attrMapRaw = attrs.get(attrsAttr);
    if (key === undefined && attrMapRaw === undefined) continue;

    const args = parseArgs(attrs.get(argsAttr));

    if (key) {
      if (!v.has(key)) {
        missing.add(key);
      } else if (!VOID_TAGS.has(tagName) && !attrChunk.trimEnd().endsWith('/')) {
        const close = findClose(html, tagName, openEnd, inSkip);
        if (close) {
          const text = t(key, args);
          const content = attrs.has(richAttr)
            ? richToHtml(parseTags(text), richTags)
            : escapeHtml(text);
          if (html.slice(openEnd, close.contentEnd) !== content) {
            if (openEnd === close.contentEnd) ms.appendLeft(openEnd, content);
            else ms.overwrite(openEnd, close.contentEnd, content);
          }
        }
      }
    }

    if (attrMapRaw !== undefined) {
      const map = parseArgs(attrMapRaw);
      if (map) {
        for (const [name, attrKey] of Object.entries(map)) {
          if (typeof attrKey !== 'string' || name.toLowerCase().startsWith('on')) continue;
          if (!v.has(attrKey)) {
            missing.add(attrKey);
            continue;
          }
          setAttribute(ms, html, chunkStart, openEnd, attrChunk, name, t(attrKey, args));
        }
      }
    }
  }

  return { html: ms.toString(), missing: [...missing] };
}

export interface RenderSiteOptions {
  site?: string;
  locales?: string[];
  attribute?: string;
  richTags?: string[];
}

export interface RenderSiteResult {
  files: number;
  locales: string[];
  missing: Record<string, string[]>;
}

// mirrors the built site per locale: dist/index.html → dist/<locale>/index.html
export async function renderSite(
  cfg: ResolvedConfig,
  options: RenderSiteOptions = {},
): Promise<RenderSiteResult> {
  const site = join(cfg.root, options.site ?? 'dist');
  const locales = options.locales ?? cfg.locales;
  const catalogs = loadCatalogs(cfg);
  const files = await glob('**/*.html', {
    cwd: site,
    absolute: true,
    ignore: locales.map((locale) => `${locale}/**`),
  });

  const missing: Record<string, string[]> = {};
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const rel = relative(site, file);
    for (const locale of locales) {
      const result = renderHtml(html, {
        locale,
        catalogs,
        sourceLocale: cfg.sourceLocale,
        attribute: options.attribute,
        richTags: options.richTags,
      });
      for (const key of result.missing) {
        const list = (missing[locale] ??= []);
        if (!list.includes(key)) list.push(key);
      }
      const out = locale === cfg.sourceLocale ? file : join(site, locale, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, result.html);
    }
  }
  return { files: files.length, locales: [...locales], missing };
}

function parseAttrs(chunk: string): Map<string, string> {
  const attrs = new Map<string, string>();
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR.exec(chunk)) !== null) {
    attrs.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function parseArgs(raw: string | undefined): Params | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(decodeEntities(raw)) as Params;
  } catch {
    console.warn(`[verbaly] invalid args JSON: ${raw}`);
    return undefined;
  }
}

// comments and script/style bodies are opaque to the scanner
function protectedRanges(html: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script\s*>|<style\b[\s\S]*?<\/style\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // keep script/style open tags scannable; protect only their bodies
    const openEnd = m[0].startsWith('<!--') ? m.index : html.indexOf('>', m.index) + 1;
    ranges.push([openEnd, m.index + m[0].length]);
  }
  return ranges;
}

function findClose(
  html: string,
  tagName: string,
  from: number,
  inSkip: (index: number) => boolean,
): { contentEnd: number } | null {
  const re = new RegExp(
    `<${tagName}(?=[\\s/>])(?:"[^"]*"|'[^']*'|[^"'>])*>|</${tagName}\\s*>`,
    'gi',
  );
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (inSkip(m.index)) continue;
    if (m[0][1] === '/') {
      depth -= 1;
      if (depth === 0) return { contentEnd: m.index };
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return null;
}

function setAttribute(
  ms: MagicString,
  html: string,
  chunkStart: number,
  openEnd: number,
  attrChunk: string,
  name: string,
  value: string,
): void {
  const escaped = escapeAttr(value);
  const existing = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*'|[^\\s>]+)`, 'i').exec(
    attrChunk,
  );
  if (existing) {
    const valueStart = chunkStart + existing.index + existing[1]!.length;
    const valueEnd = valueStart + existing[2]!.length;
    if (html.slice(valueStart, valueEnd) !== `"${escaped}"`) {
      ms.overwrite(valueStart, valueEnd, `"${escaped}"`);
    }
    return;
  }
  const selfClosing = html.slice(openEnd - 2, openEnd) === '/>';
  const insertAt = openEnd - (selfClosing ? 2 : 1);
  ms.appendLeft(insertAt, ` ${name}="${escaped}"`);
}

function richToHtml(nodes: TagNode[], allowed: Set<string>): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += escapeHtml(node);
    } else if (allowed.has(node.name)) {
      out += `<${node.name}>${richToHtml(node.children, allowed)}</${node.name}>`;
    } else {
      out += richToHtml(node.children, allowed); // unknown tag → unwrap
    }
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
