import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import MagicString from 'magic-string';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import {
  alternateLinks,
  createVerbaly,
  localeDirection,
  LOCALE_STORAGE_KEY,
  normalizeLink,
  parseTags,
  RICH_TAGS,
  safeAttribute,
  VOID_TAGS,
  type MessageTree,
  type Params,
  type RichLink,
  type TagNode,
  type Verbaly,
} from 'verbaly';
import type { Catalogs } from './catalog';
import { loadCatalogs } from './catalog';
import type { RedirectConfig, ResolvedConfig } from './config';
import { counted } from './text';

export interface Alternate {
  hreflang: string;
  href: string;
}

// links that point at a page this mirror also holds get its prefix, so the visitor stays inside
export interface MirrorLinks {
  prefix: string;
  base?: string;
  pages: ReadonlySet<string>;
}

// the pre-paint script: the locale set it chooses from, and where a saved choice lives
export interface RedirectScript {
  locales: string[];
  sourceLocale: string;
  base?: string;
  storageKey?: string | false;
}

interface RenderHtmlBase {
  locale: string;
  sourceLocale?: string;
  attribute?: string;
  richTags?: string[];
  richLinks?: Record<string, RichLink>;
  setLang?: boolean;
  alternates?: Alternate[];
  mirror?: MirrorLinks;
  redirect?: RedirectScript;
}

// one of the two, never both: an instance already carries the catalogs it was built from
export type RenderHtmlOptions = RenderHtmlBase &
  (
    | { catalogs: Catalogs | Record<string, MessageTree>; instance?: never }
    | { catalogs?: never; instance: Verbaly }
  );

// nested trees welcome: the runtime flattens them (verbaly-web's shape)
export function localeInstance(
  catalogs: Catalogs | Record<string, MessageTree>,
  locale: string,
  sourceLocale: string,
): Verbaly {
  return createVerbaly({ locale, fallback: sourceLocale, messages: catalogs });
}

export interface RenderHtmlResult {
  html: string;
  missing: string[];
}

const HREFLANG_OPEN = '<!--verbaly:hreflang-->';
const HREFLANG_CLOSE = '<!--/verbaly:hreflang-->';
const REDIRECT_OPEN = '<!--verbaly:redirect-->';
const REDIRECT_CLOSE = '<!--/verbaly:redirect-->';

const VOID = new Set(VOID_TAGS);

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

  const v = options.instance ?? localeInstance(options.catalogs, options.locale, sourceLocale);
  const t = v.t as unknown as (key: string, params?: Params) => string;

  const ms = new MagicString(html);
  const missing = new Set<string>();
  const skip = protectedRanges(html);
  const inSkip = (index: number): boolean => skip.some(([from, to]) => index >= from && index < to);

  // a message can carry markup of its own, and MagicString refuses to edit inside what it replaced
  const filled: Array<[number, number]> = [];
  const inFilled = (index: number): boolean =>
    filled.some(([from, to]) => index >= from && index < to);

  // per-locale canonical/og:url: a cross-locale canonical would void the hreflang set
  const selfUrl = options.alternates?.find((a) => a.hreflang === options.locale)?.href;
  const sourceUrl = options.alternates?.find((a) => a.hreflang === 'x-default')?.href;
  const rewriteUrl = selfUrl !== undefined && selfUrl !== sourceUrl;

  START_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = START_TAG.exec(html)) !== null) {
    if (inSkip(m.index) || inFilled(m.index)) continue;
    const [full, rawName, attrChunk] = m as unknown as [string, string, string];
    const tagName = rawName.toLowerCase();
    const openEnd = m.index + full.length;

    const chunkStart = m.index + 1 + rawName.length;

    if (tagName === 'html' && options.setLang !== false) {
      // lang and dir together: what persistLocale/switchLocale set at runtime
      setAttribute(ms, html, chunkStart, openEnd, attrChunk, 'lang', options.locale);
      setAttribute(
        ms,
        html,
        chunkStart,
        openEnd,
        attrChunk,
        'dir',
        localeDirection(options.locale),
      );
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

    const mirror = options.mirror;
    if (mirror) {
      if (tagName === 'a' || tagName === 'area') {
        const inside = mirroredHref(attrs.get('href'), mirror);
        if (inside) setAttribute(ms, html, chunkStart, openEnd, attrChunk, 'href', inside);
      } else if (tagName === 'meta' && attrs.get('http-equiv')?.toLowerCase() === 'refresh') {
        // a redirect page ships inside the mirror too, and its target must not leave it
        const content = attrs.get('content') ?? '';
        const url = /^([^;]*;\s*url\s*=\s*)(.*)$/i.exec(decodeEntities(content));
        const inside = url && mirroredHref(url[2], mirror);
        if (inside) {
          setAttribute(ms, html, chunkStart, openEnd, attrChunk, 'content', `${url![1]}${inside}`);
        }
      }
    }

    const key = attrs.get(attr);
    const attrMapRaw = attrs.get(attrsAttr);
    if (key === undefined && attrMapRaw === undefined) continue;

    const args = parseArgs(attrs.get(argsAttr));

    if (key) {
      if (!v.has(key)) {
        missing.add(key);
      } else if (!VOID.has(tagName) && !attrChunk.trimEnd().endsWith('/')) {
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
          filled.push([openEnd, close.contentEnd]);
        }
      }
    }

    if (attrMapRaw !== undefined) {
      const map = parseArgs(attrMapRaw);
      if (map) {
        for (const [name, attrKey] of Object.entries(map)) {
          if (typeof attrKey !== 'string') continue;
          if (!v.has(attrKey)) {
            missing.add(attrKey);
            continue;
          }
          const value = safeAttribute(name, t(attrKey, args));
          if (value !== undefined)
            setAttribute(ms, html, chunkStart, openEnd, attrChunk, name, value);
        }
      }
    }
  }

  if (options.alternates?.length) injectAlternates(ms, html, options.alternates);
  if (options.redirect) injectRedirect(ms, html, options.redirect);

  return { html: ms.toString(), missing: [...missing] };
}

// the public path of a built page, the shape both the page set and an author's href reduce to
export function publicPath(rel: string): string {
  const path = `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

// only a root-relative link to a page the mirror contains: assets, externals and anchors stay
function mirroredHref(raw: string | undefined, mirror: MirrorLinks): string | undefined {
  if (raw === undefined) return undefined;
  const href = decodeEntities(raw);
  if (!href.startsWith('/') || href.startsWith('//')) return undefined;
  const base = mirror.base ?? '';
  // hrefs carry the base the site is served under, the page set never does: compare like with like
  const inside = base ? stripBase(href, base) : href;
  if (base && inside === href) return undefined;
  const cut = inside.search(/[?#]/);
  const path = cut < 0 ? inside : inside.slice(0, cut);
  if (!mirror.pages.has(publicPath(path.replace(/^\//, '')))) return undefined;
  return `${base}${mirror.prefix}${inside}`;
}

// the boundary check is what keeps base /app from swallowing /application
function stripBase(path: string, base: string): string {
  if (!path.startsWith(base)) return path;
  const rest = path.slice(base.length);
  if (rest === '') return '/';
  return rest.startsWith('/') ? rest : path;
}

// 'app', '/app' and '/app/' all read as '/app'; nothing means the site sits at the root
function normalizeBase(base: string | undefined): string {
  const trimmed = base?.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed ? `/${trimmed}` : '';
}

// the narrowing of matchPathSegment, inlined: render == runtime has to hold here too
const REDIRECT_BODY =
  '(function(){var T=/^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|[0-9]{3}))?$/i;' +
  'function M(t,g){t=String(t||"");if(S.indexOf(t)>=0)return t;if(g&&!T.test(t))return;' +
  'while(t){var i=t.lastIndexOf("-");if(i<0)return;t=t.slice(0,i);if(S.indexOf(t)>=0)return t}}' +
  'var p=location.pathname;' +
  'if(B){if(p.indexOf(B)!==0)return;p=p.slice(B.length)||"/";if(p.charAt(0)!=="/")return}' +
  'if(M(p.split("/")[1],1))return;' +
  'var w;if(K)try{w=M(localStorage.getItem(K))}catch(e){}' +
  'if(!w){var l=navigator.languages||[navigator.language];for(var i=0;i<l.length&&!w;i++)w=M(l[i])}' +
  'if(!w||w===D)return;location.replace(B+"/"+w+p+location.search+location.hash)})()';

// </script> can never appear in a locale code, but a catalog is untrusted and this costs nothing
function jsLiteral(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, '\\u003c');
}

// pre-paint, in the source tree only: the mirror page a visitor lands on is already the answer
function redirectScript(options: RedirectScript): string {
  const vars = [
    `S=${jsLiteral(options.locales)}`,
    `D=${jsLiteral(options.sourceLocale)}`,
    `B=${jsLiteral(normalizeBase(options.base))}`,
    `K=${options.storageKey === false ? 'null' : jsLiteral(options.storageKey ?? LOCALE_STORAGE_KEY)}`,
  ].join(',');
  return `<script>var ${vars};${REDIRECT_BODY};</script>`;
}

// goes first in <head> so it runs before a stylesheet can paint, idempotent via markers
function injectRedirect(ms: MagicString, html: string, options: RedirectScript): void {
  const block = `${REDIRECT_OPEN}${redirectScript(options)}${REDIRECT_CLOSE}`;
  const from = html.indexOf(REDIRECT_OPEN);
  if (from !== -1) {
    const to = html.indexOf(REDIRECT_CLOSE, from);
    if (to !== -1) {
      const end = to + REDIRECT_CLOSE.length;
      if (html.slice(from, end) !== block) ms.overwrite(from, end, block);
      return;
    }
  }
  const head = /<head\b(?:"[^"]*"|'[^']*'|[^"'>])*>/i.exec(html);
  if (head) ms.appendRight(head.index + head[0].length, block);
}

// injects <link rel="alternate" hreflang> into <head>, idempotent via markers
function injectAlternates(ms: MagicString, html: string, alternates: Alternate[]): void {
  const links = alternates
    .map(
      (a) =>
        `<link rel="alternate" hreflang="${escapeAttr(a.hreflang)}" href="${escapeAttr(a.href)}">`,
    )
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
  base?: string;
  baseUrl?: string;
  hreflang?: boolean;
  exclude?: string[];
  sitemap?: boolean | string;
  redirect?: boolean | RedirectConfig;
  clean?: boolean;
}

export interface RenderSiteResult {
  files: number;
  locales: string[];
  missing: Record<string, string[]>;
  untranslatedHead: string[];
}

const TITLE_TAG = /<title\b([^>]*)>/i;
const REFRESH_META = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i;

const NOINDEX_META = /<meta\b[^>]*name\s*=\s*["']?robots["']?[^>]*content\s*=\s*["'][^"']*noindex/i;

// the mirror still publishes these, they are simply never search results
function isIndexable(html: string): boolean {
  return !REFRESH_META.test(html) && !NOINDEX_META.test(html);
}

// a <title> with no key ships the source language everywhere, and it is most of a search result
function headIsBound(html: string, attr: string): boolean {
  // a page that only redirects is never a search result, so its title is nobody's to translate
  if (REFRESH_META.test(html)) return true;
  const title = TITLE_TAG.exec(html);
  return title ? title[1]!.includes(attr) : true;
}

// mirrors the built site per locale: dist/index.html → dist/<locale>/index.html
export async function renderSite(
  cfg: ResolvedConfig,
  options: RenderSiteOptions = {},
): Promise<RenderSiteResult> {
  const site = join(cfg.root, options.site ?? cfg.render.site ?? 'dist');
  const locales = options.locales ?? cfg.locales;
  const attribute = options.attribute ?? cfg.render.attribute;
  const base = normalizeBase(options.base ?? cfg.render.base);
  const baseUrl = (options.baseUrl ?? cfg.render.baseUrl)?.replace(/\/+$/, '');
  const wantHreflang = (options.hreflang ?? cfg.render.hreflang ?? true) && baseUrl !== undefined;
  // the escape hatch for a page that is indexable and still not ours to list
  const patterns = options.exclude ?? cfg.render.exclude ?? [];
  const excluded = patterns.length > 0 ? picomatch(patterns) : () => false;
  const sitemap = options.sitemap ?? cfg.render.sitemap ?? false;
  const wantSitemap = sitemap !== false && baseUrl !== undefined;
  const clean = options.clean ?? cfg.render.clean ?? false;
  const wanted = options.redirect ?? cfg.render.redirect ?? false;
  const redirect = wanted === false ? undefined : wanted === true ? {} : wanted;
  const script: RedirectScript | undefined = redirect && {
    locales,
    sourceLocale: cfg.sourceLocale,
    base,
    storageKey: redirect.storageKey,
  };
  const catalogs = loadCatalogs(cfg);
  // one runtime per locale for the whole run: rebuilding it per page reflattened every catalog
  const instances = new Map(
    locales.map((locale) => [locale, localeInstance(catalogs, locale, cfg.sourceLocale)]),
  );

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

  // every page the mirror will hold, so a link into one of them can keep the visitor inside
  const pages = new Set(files.map((file) => publicPath(relative(site, file).replace(/\\/g, '/'))));

  const missing: Record<string, string[]> = {};
  const untranslatedHead: string[] = [];
  const urls: Array<{ rel: string; alternates: Alternate[] }> = [];
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    const rel = relative(site, file).replace(/\\/g, '/');
    // one locale is not a mirror, so there is no second title for this one to disagree with
    if (locales.length > 1 && !headIsBound(html, attribute ?? 'data-verbaly')) {
      untranslatedHead.push(rel);
    }
    const alternates = wantHreflang ? pageAlternates(baseUrl!, rel, locales, cfg.sourceLocale) : [];
    if (wantHreflang && isIndexable(html) && !excluded(rel)) urls.push({ rel, alternates });
    // only the source tree carries it: the mirror page a visitor reaches is already the answer
    const routed = script && (redirect!.on === 'all' || rel === 'index.html');
    for (const locale of locales) {
      const result = renderHtml(html, {
        locale,
        instance: instances.get(locale)!,
        sourceLocale: cfg.sourceLocale,
        attribute,
        richTags: options.richTags,
        richLinks: options.richLinks ?? cfg.render.links,
        alternates,
        mirror: locale === cfg.sourceLocale ? undefined : { prefix: `/${locale}`, base, pages },
        redirect: routed && locale === cfg.sourceLocale ? script : undefined,
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
    const name = typeof sitemap === 'string' ? sitemap : 'sitemap-i18n.xml';
    writeFileSync(join(site, name), buildSitemap(urls));
  }

  return { files: files.length, locales: [...locales], missing, untranslatedHead };
}

// the cli and @verbaly/astro both run the mirror, so what it warns about is written once
export function formatRenderWarnings(result: RenderSiteResult, sourceLocale: string): string[] {
  const lines: string[] = [];
  for (const [locale, keys] of Object.entries(result.missing)) {
    lines.push(`  ${locale}: ${counted(keys.length, 'key')} not pre-filled: ${keys.join(', ')}`);
  }
  if (result.untranslatedHead.length > 0) {
    lines.push(
      `  ${counted(result.untranslatedHead.length, 'page')} of ${result.files} ship the same <title> in every locale (${result.untranslatedHead[0]}), so search results read in ${sourceLocale}`,
      `    fix: bind the head too, <title data-verbaly="key"> and a meta through data-verbaly-attr`,
    );
  }
  return lines;
}

// request path of a built page path (index.html → directory URL)
function pagePath(rel: string): string {
  const path = rel.replace(/(^|\/)index\.html$/, '$1');
  return path ? `/${path}` : '/';
}

// reciprocal hreflang set for one page, from core: an SSR head has to write the same one
function pageAlternates(
  baseUrl: string,
  rel: string,
  locales: string[],
  sourceLocale: string,
): Alternate[] {
  return alternateLinks({
    supported: locales,
    sourceLocale,
    path: pagePath(rel),
    routing: 'prefix-except-source',
    baseUrl,
  });
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
      const { href, target, rel } = normalizeLink(links[node.name]!);
      let attrs = href !== undefined ? ` href="${escapeAttr(href)}"` : '';
      if (target) attrs += ` target="${escapeAttr(target)}"`;
      if (rel) attrs += ` rel="${escapeAttr(rel)}"`;
      out += `<a${attrs}>${richToHtml(node.children, allowed, links)}</a>`;
    } else if (allowed.has(node.name)) {
      out += VOID.has(node.name)
        ? `<${node.name}>`
        : `<${node.name}>${richToHtml(node.children, allowed, links)}</${node.name}>`;
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
