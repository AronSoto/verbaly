import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import MagicString from 'magic-string';
import { glob } from 'tinyglobby';
import {
  createVerbaly,
  parseTags,
  RICH_TAGS,
  safeHref,
  type MessageTree,
  type Params,
  type RichLink,
  type TagNode,
} from 'verbaly';
import type { Catalogs } from './catalog';
import { loadCatalogs } from './catalog';
import type { ResolvedConfig } from './config';

export interface Alternate {
  hreflang: string;
  href: string;
}

export interface RenderHtmlOptions {
  locale: string;
  // nested trees welcome — the runtime flattens them (verbaly-web's shape)
  catalogs: Catalogs | Record<string, MessageTree>;
  sourceLocale?: string;
  attribute?: string;
  richTags?: string[];
  richLinks?: Record<string, RichLink>;
  setLang?: boolean;
  alternates?: Alternate[];
}

export interface RenderHtmlResult {
  html: string;
  missing: string[];
}

const HREFLANG_OPEN = '<!--verbaly:hreflang-->';
const HREFLANG_CLOSE = '<!--/verbaly:hreflang-->';

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
const ATTR = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// pre-fills data-verbaly elements for one locale; the runtime stays functional
export function renderHtml(html: string, options: RenderHtmlOptions): RenderHtmlResult {
  const attr = options.attribute ?? 'data-verbaly';
  const argsAttr = `${attr}-args`;
  const attrsAttr = `${attr}-attr`;
  const richAttr = `${attr}-rich`;
  const linksAttr = `${attr}-links`;
  const richTags = new Set(options.richTags ?? RICH_TAGS);
  const globalLinks = options.richLinks;
  const sourceLocale = options.sourceLocale ?? 'en';

  // '' = untranslated — the runtime lookup falls back on its own (nested or flat)
  const v = createVerbaly({
    locale: options.locale,
    fallback: sourceLocale,
    messages: options.catalogs,
  });
  const t = v.t as unknown as (key: string, params?: Params) => string;

  const ms = new MagicString(html);
  const missing = new Set<string>();
  const skip = protectedRanges(html);
  const inSkip = (index: number): boolean => skip.some(([from, to]) => index >= from && index < to);

  // per-locale canonical/og:url — a cross-locale canonical would void the hreflang set
  const selfUrl = options.alternates?.find((a) => a.hreflang === options.locale)?.href;
  const sourceUrl = options.alternates?.find((a) => a.hreflang === 'x-default')?.href;
  const rewriteUrl = selfUrl !== undefined && selfUrl !== sourceUrl;

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

    if (
      rewriteUrl &&
      tagName === 'link' &&
      attrs.get('rel')?.toLowerCase() === 'canonical' &&
      decodeEntities(attrs.get('href') ?? '') === sourceUrl
    ) {
      setAttribute(ms, html, chunkStart, openEnd, attrChunk, 'href', selfUrl!);
    }
    if (
      rewriteUrl &&
      tagName === 'meta' &&
      attrs.get('property') === 'og:url' &&
      decodeEntities(attrs.get('content') ?? '') === sourceUrl
    ) {
      setAttribute(ms, html, chunkStart, openEnd, attrChunk, 'content', selfUrl!);
    }

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
          const own = parseArgs(attrs.get(linksAttr)) as Record<string, RichLink> | undefined;
          const links = own ? (globalLinks ? { ...globalLinks, ...own } : own) : globalLinks;
          const content = attrs.has(richAttr)
            ? richToHtml(parseTags(text), richTags, links)
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

  if (options.alternates?.length) injectAlternates(ms, html, options.alternates);

  return { html: ms.toString(), missing: [...missing] };
}

// injects <link rel="alternate" hreflang> into <head>, idempotent via markers
function injectAlternates(ms: MagicString, html: string, alternates: Alternate[]): void {
  const links = alternates
    .map((a) => `<link rel="alternate" hreflang="${escapeAttr(a.hreflang)}" href="${escapeAttr(a.href)}">`)
    .join('');
  const block = `${HREFLANG_OPEN}${links}${HREFLANG_CLOSE}`;
  const from = html.indexOf(HREFLANG_OPEN);
  if (from !== -1) {
    const to = html.indexOf(HREFLANG_CLOSE, from);
    if (to !== -1) {
      const end = to + HREFLANG_CLOSE.length;
      if (html.slice(from, end) !== block) ms.overwrite(from, end, block);
      return;
    }
  }
  const head = /<\/head\s*>/i.exec(html);
  if (head) ms.appendLeft(head.index, block);
}

export interface RenderSiteOptions {
  site?: string;
  locales?: string[];
  attribute?: string;
  richTags?: string[];
  richLinks?: Record<string, RichLink>;
  baseUrl?: string;
  hreflang?: boolean;
  sitemap?: boolean | string;
  clean?: boolean;
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
  const site = join(cfg.root, options.site ?? cfg.render.site ?? 'dist');
  const locales = options.locales ?? cfg.locales;
  const attribute = options.attribute ?? cfg.render.attribute;
  const baseUrl = (options.baseUrl ?? cfg.render.baseUrl)?.replace(/\/+$/, '');
  const wantHreflang = (options.hreflang ?? cfg.render.hreflang ?? true) && baseUrl !== undefined;
  const wantSitemap = (options.sitemap ?? cfg.render.sitemap ?? false) && baseUrl !== undefined;
  const clean = options.clean ?? cfg.render.clean ?? false;
  const catalogs = loadCatalogs(cfg);

  if (clean) {
    for (const locale of locales) {
      if (locale !== cfg.sourceLocale) rmSync(join(site, locale), { recursive: true, force: true });
    }
  }

  const files = await glob('**/*.html', {
    cwd: site,
    absolute: true,
    ignore: locales.map((locale) => `${locale}/**`),
  });

  const missing: Record<string, string[]> = {};
  const urls: Array<{ rel: string; alternates: Alternate[] }> = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const rel = relative(site, file).replace(/\\/g, '/');
    const alternates = wantHreflang ? pageAlternates(baseUrl!, rel, locales, cfg.sourceLocale) : [];
    if (wantHreflang) urls.push({ rel, alternates });
    for (const locale of locales) {
      const result = renderHtml(html, {
        locale,
        catalogs,
        sourceLocale: cfg.sourceLocale,
        attribute,
        richTags: options.richTags,
        richLinks: options.richLinks ?? cfg.render.links,
        alternates,
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

  if (wantSitemap && urls.length) {
    const name = typeof wantSitemap === 'string' ? wantSitemap : 'sitemap-i18n.xml';
    writeFileSync(join(site, name), buildSitemap(urls));
  }

  return { files: files.length, locales: [...locales], missing };
}

// public URL of a built page path (index.html → directory URL)
function pageUrl(baseUrl: string, prefix: string, rel: string): string {
  const path = rel.replace(/(^|\/)index\.html$/, '$1');
  return `${baseUrl}${prefix}${path ? `/${path}` : '/'}`;
}

// reciprocal hreflang set for one page across every locale (+ x-default = source)
function pageAlternates(
  baseUrl: string,
  rel: string,
  locales: string[],
  sourceLocale: string,
): Alternate[] {
  const alternates: Alternate[] = [];
  for (const locale of locales) {
    const prefix = locale === sourceLocale ? '' : `/${locale}`;
    alternates.push({ hreflang: locale, href: pageUrl(baseUrl, prefix, rel) });
  }
  alternates.push({ hreflang: 'x-default', href: pageUrl(baseUrl, '', rel) });
  return alternates;
}

function buildSitemap(urls: Array<{ rel: string; alternates: Alternate[] }>): string {
  const body = urls
    .flatMap(({ alternates }) => {
      const alts = alternates
        .map(
          (a) =>
            `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeAttr(a.href)}"/>`,
        )
        .join('');
      return alternates
        .filter((a) => a.hreflang !== 'x-default')
        .map((self) => `<url><loc>${escapeAttr(self.href)}</loc>${alts}</url>`);
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>\n`;
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

function richToHtml(
  nodes: TagNode[],
  allowed: Set<string>,
  links?: Record<string, RichLink>,
): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += escapeHtml(node);
    } else if (links?.[node.name] !== undefined) {
      const link = links[node.name]!;
      const { href, target, rel }: Exclude<RichLink, string> =
        typeof link === 'string' ? { href: link } : link;
      const safe = safeHref(href);
      let attrs = safe !== undefined ? ` href="${escapeAttr(safe)}"` : '';
      if (target) attrs += ` target="${escapeAttr(target)}"`;
      if (rel) attrs += ` rel="${escapeAttr(rel)}"`;
      out += `<a${attrs}>${richToHtml(node.children, allowed, links)}</a>`;
    } else if (allowed.has(node.name)) {
      out += `<${node.name}>${richToHtml(node.children, allowed, links)}</${node.name}>`;
    } else {
      out += richToHtml(node.children, allowed, links); // unknown tag → unwrap
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
