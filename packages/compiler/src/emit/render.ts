import MagicString from 'magic-string';
import {
  createVerbaly,
  localeDirection,
  LOCALE_STORAGE_KEY,
  normalizeLink,
  parseTags,
  RICH_TAGS,
  CATALOG_SCRIPT,
  safeAttribute,
  VOID_TAGS,
  type MessageTree,
  type Params,
  type RichLink,
  type TagNode,
  type TrailingSlash,
  type Verbaly,
} from 'verbaly';
import { emptyCatalog, type Catalogs } from '../catalog/catalog';
import { blocks, type BlockShape } from '../util/blocks';
import { decodeEntities, isAttributeName, readAttributes, type Attribute } from '../util/markup';
import { trimTrailingSlashes } from '../util/text';
import { warnOnce } from '../util/warn';

export interface Alternate {
  hreflang: string;
  href: string;
}

// links that point at a page this mirror also holds get its prefix, so the visitor stays inside
export interface MirrorLinks {
  prefix: string;
  base?: string;
  pages: ReadonlySet<string>;
  trailingSlash?: TrailingSlash;
}

// the pre-paint script: the locale set it chooses from, and where a saved choice lives
export interface RedirectScript {
  locales: string[];
  sourceLocale: string;
  base?: string;
  storageKey?: string | false;
  trailingSlash?: TrailingSlash;
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
  inlineCatalog?: boolean;
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
  // every key this page resolved: the exact set a visitor needs, and nothing else
  used: string[];
}

const HREFLANG_OPEN = '<!--verbaly:hreflang-->';
const HREFLANG_CLOSE = '<!--/verbaly:hreflang-->';
const CATALOG_OPEN = '<!--verbaly:catalog-->';
const CATALOG_CLOSE = '<!--/verbaly:catalog-->';
const REDIRECT_OPEN = '<!--verbaly:redirect-->';
const REDIRECT_CLOSE = '<!--/verbaly:redirect-->';

const VOID = new Set(VOID_TAGS);

const START_TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;

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
  const used = new Set<string>();
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
    // read once and written where it was read: a name inside another value is not an attribute
    const attrs = readAttributes(attrChunk, true);
    const read = (name: string): string | undefined => attrs.get(name)?.value;
    const set = (name: string, value: string): void =>
      setAttribute(ms, html, chunkStart, openEnd, attrs, name, value);

    if (tagName === 'html' && options.setLang !== false) {
      // lang and dir together: what persistLocale/switchLocale set at runtime
      set('lang', options.locale);
      set('dir', localeDirection(options.locale));
      continue;
    }

    if (
      rewriteUrl &&
      tagName === 'link' &&
      read('rel')?.toLowerCase() === 'canonical' &&
      sameUrl(decodeEntities(read('href') ?? ''), sourceUrl)
    ) {
      set('href', selfUrl!);
    }
    if (
      rewriteUrl &&
      tagName === 'meta' &&
      read('property') === 'og:url' &&
      sameUrl(decodeEntities(read('content') ?? ''), sourceUrl)
    ) {
      set('content', selfUrl!);
    }

    const mirror = options.mirror;
    if (mirror) {
      if (tagName === 'a' || tagName === 'area') {
        const inside = mirroredHref(read('href'), mirror);
        if (inside) set('href', inside);
      } else if (tagName === 'form' || tagName === 'button' || tagName === 'input') {
        // submitting navigates: a form landing on a page we mirrored belongs in the mirror too
        const name = tagName === 'form' ? 'action' : 'formaction';
        const inside = mirroredHref(read(name), mirror);
        if (inside) set(name, inside);
      } else if (tagName === 'meta' && read('http-equiv')?.toLowerCase() === 'refresh') {
        // a redirect page ships inside the mirror too, and its target must not leave it
        const content = read('content') ?? '';
        const url = /^([^;]*;\s*url\s*=\s*)(.*)$/i.exec(decodeEntities(content));
        const inside = url && mirroredHref(url[2], mirror);
        if (inside) set('content', `${url![1]}${inside}`);
      }
    }

    const key = read(attr);
    const attrMapRaw = read(attrsAttr);
    if (key === undefined && attrMapRaw === undefined) continue;

    const args = parseArgs(read(argsAttr), argsAttr);

    if (key) {
      if (!v.has(key)) {
        missing.add(key);
      } else if (!VOID.has(tagName) && !attrChunk.trimEnd().endsWith('/')) {
        used.add(key);
        const close = findClose(html, tagName, openEnd, inSkip);
        if (close) {
          const text = t(key, args);
          const own = parseArgs(read(linksAttr), linksAttr) as Record<string, RichLink> | undefined;
          const merged = own ? (globalLinks ? { ...globalLinks, ...own } : own) : globalLinks;
          // a link inside a message is a link: without the prefix it leaves the mirror
          const links = mirror ? mirroredLinks(merged, mirror) : merged;
          const nodes = attrs.has(richAttr) ? parseTags(text) : [];
          // the page carries its own links: the runtime rebuilds from here, never from the config
          if (mirror && links) {
            const carried = usedLinks(nodes, links);
            if (carried && JSON.stringify(carried) !== JSON.stringify(own)) {
              set(linksAttr, JSON.stringify(carried));
            }
          }
          const content = attrs.has(richAttr)
            ? richToHtml(nodes, richTags, links)
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
      const map = parseArgs(attrMapRaw, attrsAttr);
      if (map) {
        for (const [name, attrKey] of Object.entries(map)) {
          if (typeof attrKey !== 'string') continue;
          if (!isAttributeName(name)) {
            warnOnce(`${attrsAttr} names "${name}", which is not an attribute name`);
            continue;
          }
          if (!v.has(attrKey)) {
            missing.add(attrKey);
            continue;
          }
          used.add(attrKey);
          const value = safeAttribute(name, t(attrKey, args));
          if (value !== undefined) set(name, value);
        }
      }
    }
  }

  if (options.alternates?.length) injectAlternates(ms, html, options.alternates);
  if (options.redirect) injectRedirect(ms, html, options.redirect);
  // the source catalog always ships eagerly, so its own tree gains nothing from a slice
  if (options.inlineCatalog && options.locale !== sourceLocale) {
    const slice = pageSlice(v, options.locale, used);
    if (Object.keys(slice).length > 0) injectCatalog(ms, html, slice);
  }

  return { html: ms.toString(), missing: [...missing], used: [...used] };
}

// every key the page used, '' where the locale falls back: a short slice is not an empty message
function pageSlice(v: Verbaly, locale: string, used: Set<string>): Record<string, string> {
  const slice = emptyCatalog();
  for (const key of used) {
    const found = v.inspect(key);
    slice[key] = found?.from === locale ? found.source : '';
  }
  return slice;
}

// the author's canonical in either form: /about and /about/ are one page however the site ends
function sameUrl(written: string, url: string | undefined): boolean {
  return url !== undefined && trimTrailingSlashes(written) === trimTrailingSlashes(url);
}

// the public path of a built page, the shape both the page set and an author's href reduce to
export function publicPath(rel: string): string {
  const path = `/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
  return path.length > 1 ? trimTrailingSlashes(path) : path;
}

// own entries only: a tag named constructor in a message must not find the one on Object
function linkFor(links: Record<string, RichLink> | undefined, name: string): RichLink | undefined {
  return links && Object.hasOwn(links, name) ? links[name] : undefined;
}

// only the names this message actually renders: a global map has entries other messages use
function usedLinks(
  nodes: TagNode[],
  links: Record<string, RichLink>,
): Record<string, RichLink> | undefined {
  const out = emptyCatalog<RichLink>();
  const walk = (list: TagNode[]): void => {
    for (const node of list) {
      if (typeof node === 'string') continue;
      const link = linkFor(links, node.name);
      if (link !== undefined) out[node.name] = link;
      walk(node.children);
    }
  };
  walk(nodes);
  return Object.keys(out).length > 0 ? out : undefined;
}

// same rule as an author's href, applied to the links a message renders through its map
function mirroredLinks(
  links: Record<string, RichLink> | undefined,
  mirror: MirrorLinks,
): Record<string, RichLink> | undefined {
  if (!links) return links;
  const out = emptyCatalog<RichLink>();
  for (const [name, link] of Object.entries(links)) {
    const href = typeof link === 'string' ? link : link.href;
    const inside = mirroredHref(href, mirror);
    if (inside === undefined) out[name] = link;
    else out[name] = typeof link === 'string' ? inside : { ...link, href: inside };
  }
  return out;
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
  // the home link: / under a prefix is /es/, a form a site that never ends in / does not serve
  const home = path === '/' && mirror.trailingSlash === 'never';
  return `${base}${mirror.prefix}${home ? inside.slice(1) : inside}`;
}

// the boundary check is what keeps base /app from swallowing /application
function stripBase(path: string, base: string): string {
  if (!path.startsWith(base)) return path;
  const rest = path.slice(base.length);
  if (rest === '') return '/';
  return rest.startsWith('/') ? rest : path;
}

// 'app', '/app' and '/app/' all read as '/app'; nothing means the site sits at the root
export function normalizeBase(base: string | undefined): string {
  const trimmed = trimTrailingSlashes(base?.replace(/^\/+/, '') ?? '');
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
  'if(!w||w===D)return;location.replace(B+"/"+w+(N&&p==="/"?"":p)+location.search+location.hash)})()';

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
    `N=${options.trailingSlash === 'never' ? 1 : 0}`,
  ].join(',');
  return `<script>var ${vars};${REDIRECT_BODY};</script>`;
}

const HEAD_OPEN = /<head\b(?:"[^"]*"|'[^']*'|[^"'>])*>/i;
const HEAD_CLOSE = /<\/head\s*>/i;

// a block a past run wrote is replaced between its markers, a new one goes into the head
function betweenMarkers(
  ms: MagicString,
  html: string,
  [open, close]: [string, string],
  content: string,
  where: 'first' | 'last',
): void {
  const block = `${open}${content}${close}`;
  const from = html.indexOf(open);
  const to = from === -1 ? -1 : html.indexOf(close, from);
  if (to !== -1) {
    const end = to + close.length;
    if (html.slice(from, end) !== block) ms.overwrite(from, end, block);
    return;
  }
  const head = (where === 'first' ? HEAD_OPEN : HEAD_CLOSE).exec(html);
  if (!head) return;
  if (where === 'first') ms.appendRight(head.index + head[0].length, block);
  else ms.appendLeft(head.index, block);
}

// goes first in <head> so it runs before a stylesheet can paint, idempotent via markers
function injectRedirect(ms: MagicString, html: string, options: RedirectScript): void {
  betweenMarkers(ms, html, [REDIRECT_OPEN, REDIRECT_CLOSE], redirectScript(options), 'first');
}

// injects <link rel="alternate" hreflang> into <head>, idempotent via markers
function injectAlternates(ms: MagicString, html: string, alternates: Alternate[]): void {
  const links = alternates
    .map(
      (a) =>
        `<link rel="alternate" hreflang="${escapeAttr(a.hreflang)}" href="${escapeAttr(a.href)}">`,
    )
    .join('');
  betweenMarkers(ms, html, [HREFLANG_OPEN, HREFLANG_CLOSE], links, 'last');
}

// inlines the slice this page needs, so a mirrored page fetches no catalog at all
function injectCatalog(ms: MagicString, html: string, messages: Record<string, string>): void {
  // <!-- opens a state where the closing </script> no longer closes, and JSON has no escape for it
  const json = JSON.stringify(messages).replace(/<\//g, '<\\/').replace(/<!--/g, '\\u003c!--');
  const tag = `<script ${CATALOG_SCRIPT} type="application/json">${json}</script>`;
  betweenMarkers(ms, html, [CATALOG_OPEN, CATALOG_CLOSE], tag, 'last');
}

// three attributes share this parser, so the report names the one that is actually malformed
function parseArgs(raw: string | undefined, attribute: string): Params | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(decodeEntities(raw)) as Params;
  } catch {
    // a page is mirrored once per locale, so a raw warn says the same thing once per tree
    warnOnce(`invalid JSON in ${attribute}: ${raw}`, `${attribute}:${raw}`);
    return undefined;
  }
}

// where a browser ends each: </name before whitespace, / or >, and a comment at -->, --!> or <!-->
export const OPAQUE_BLOCKS: BlockShape[] = [
  { open: '<!--', close: /(?<=<!--)-?>|--!?>/g },
  { open: /<script\b/gi, close: /<\/script(?=[\t\n\f\r />])/gi, closeTag: true },
  { open: /<style\b/gi, close: /<\/style(?=[\t\n\f\r />])/gi, closeTag: true },
];

// comments and script/style bodies are opaque to the scanner
function protectedRanges(html: string): Array<[number, number]> {
  return blocks(html, OPAQUE_BLOCKS).map(({ start, end }) => {
    // keep script/style open tags scannable; protect only their bodies
    const openEnd = html.startsWith('<!--', start) ? start : html.indexOf('>', start) + 1;
    return [openEnd, end];
  });
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
  attrs: Map<string, Attribute>,
  name: string,
  value: string,
): void {
  const written = `"${escapeAttr(value)}"`;
  const existing = attrs.get(name.toLowerCase());
  if (existing) {
    const from = chunkStart + existing.start;
    const to = chunkStart + existing.end;
    // an attribute written with no value gets one where its name ends
    if (from === to) ms.appendLeft(from, `=${written}`);
    else if (html.slice(from, to) !== written) ms.overwrite(from, to, written);
    return;
  }
  const selfClosing = html.slice(openEnd - 2, openEnd) === '/>';
  const insertAt = openEnd - (selfClosing ? 2 : 1);
  ms.appendLeft(insertAt, ` ${name}=${written}`);
}

function richToHtml(
  nodes: TagNode[],
  allowed: Set<string>,
  links?: Record<string, RichLink>,
): string {
  let out = '';
  for (const node of nodes) {
    const link = typeof node === 'string' ? undefined : linkFor(links, node.name);
    if (typeof node === 'string') {
      out += escapeHtml(node);
    } else if (link !== undefined) {
      const { href, target, rel } = normalizeLink(link);
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

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}
