import { parseTags, type TagNode } from './tags';
import type { DictionaryInput, Params, Verbaly } from './types';

// hrefs come from the caller, never from messages
export type RichLink = string | { href: string; target?: string; rel?: string };

export interface BindDomOptions {
  root?: ParentNode;
  attribute?: string;
  richTags?: string[];
  richLinks?: Record<string, RichLink>;
}

const UNSAFE_HREF = /^\s*(javascript|data|vbscript):/i;
const URL_ATTR = /^(href|src|xlink:href|action|formaction)$/;
const BLOCKED_ATTR = /^(style|srcdoc)$/;

export function safeHref(href: string): string | undefined {
  if (UNSAFE_HREF.test(href)) {
    console.warn(`[verbaly] blocked unsafe href: ${href}`);
    return undefined;
  }
  return href;
}

// one link normalization for core + every adapter (applies safeHref)
export function normalizeLink(link: RichLink): { href?: string; target?: string; rel?: string } {
  const { href, target, rel } = typeof link === 'string' ? { href: link } : link;
  return { href: safeHref(href), target, rel };
}

// phrasing-only, attribute-less → XSS-safe
export const RICH_TAGS = [
  'em',
  'strong',
  'code',
  'b',
  'i',
  'u',
  's',
  'small',
  'mark',
  'sub',
  'sup',
  'span',
  'kbd',
  'abbr',
  'br',
  'wbr',
];

export function bindDom<D extends DictionaryInput>(
  instance: Verbaly<D>,
  options: BindDomOptions = {},
): () => void {
  if (typeof document === 'undefined') {
    throw new Error('[verbaly] bindDom requires a DOM');
  }
  const t = instance.t as unknown as (key: string, params?: Params) => string;
  const root = options.root ?? document.body;
  const attr = options.attribute ?? 'data-verbaly';
  const argsAttr = `${attr}-args`;
  const attrsAttr = `${attr}-attr`;
  const richAttr = `${attr}-rich`;
  const linksAttr = `${attr}-links`;
  const richTags = new Set(options.richTags ?? RICH_TAGS);
  const globalLinks = options.richLinks;
  const argsCache = new WeakMap<Element, { raw: string | null; params: Params | undefined }>();
  const linksCache = new WeakMap<
    Element,
    { raw: string | null; links: Record<string, RichLink> | undefined }
  >();
  const attrsCache = new WeakMap<Element, { raw: string | null; map: Params | undefined }>();

  function cachedArgs(el: Element): Params | undefined {
    const raw = el.getAttribute(argsAttr);
    const hit = argsCache.get(el);
    if (hit && hit.raw === raw) return hit.params;
    const params = parseArgs(raw);
    argsCache.set(el, { raw, params });
    return params;
  }

  function cachedLinks(el: Element): Record<string, RichLink> | undefined {
    const raw = el.getAttribute(linksAttr);
    if (!raw) return globalLinks;
    const hit = linksCache.get(el);
    if (hit && hit.raw === raw) return hit.links;
    const own = parseArgs(raw) as Record<string, RichLink> | undefined;
    const links = own ? (globalLinks ? { ...globalLinks, ...own } : own) : globalLinks;
    linksCache.set(el, { raw, links });
    return links;
  }

  function renderRich(
    el: Element,
    nodes: TagNode[],
    links: Record<string, RichLink> | undefined,
  ): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        el.append(node);
      } else if (links?.[node.name] !== undefined) {
        const { href, target, rel } = normalizeLink(links[node.name]!);
        const a = el.ownerDocument.createElement('a');
        if (href !== undefined) a.setAttribute('href', href);
        if (target) a.setAttribute('target', target);
        if (rel) a.setAttribute('rel', rel);
        renderRich(a, node.children, links);
        el.append(a);
      } else if (richTags.has(node.name)) {
        const child = el.ownerDocument.createElement(node.name);
        renderRich(child, node.children, links);
        el.append(child);
      } else {
        renderRich(el, node.children, links); // unknown tag → unwrap
      }
    }
  }

  function render(el: Element): void {
    const args = cachedArgs(el);
    const key = el.getAttribute(attr);
    if (key) {
      const text = t(key, args);
      if (el.hasAttribute(richAttr)) {
        el.textContent = '';
        renderRich(el, parseTags(text), cachedLinks(el));
      } else {
        el.textContent = text;
      }
    }

    const rawAttrs = el.getAttribute(attrsAttr);
    const attrsHit = attrsCache.get(el);
    const attrMap = attrsHit && attrsHit.raw === rawAttrs ? attrsHit.map : parseArgs(rawAttrs);
    if (!attrsHit || attrsHit.raw !== rawAttrs) attrsCache.set(el, { raw: rawAttrs, map: attrMap });
    if (attrMap) {
      for (const [name, attrKey] of Object.entries(attrMap)) {
        const lower = name.toLowerCase();
        if (typeof attrKey !== 'string' || lower.startsWith('on') || BLOCKED_ATTR.test(lower))
          continue;
        let value = t(attrKey, args);
        if (URL_ATTR.test(lower)) {
          const safe = safeHref(value);
          if (safe === undefined) continue;
          value = safe;
        }
        el.setAttribute(name, value);
      }
    }
  }

  const selector = `[${attr}], [${attrsAttr}]`;

  function renderAll(scope: ParentNode | Element): void {
    if (scope instanceof Element && scope.matches(selector)) render(scope);
    for (const el of scope.querySelectorAll(selector)) render(el);
  }

  renderAll(root);
  const unsubscribe = instance.subscribe(() => renderAll(root));

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) {
        render(record.target);
      } else if (record.type === 'childList') {
        for (const node of record.addedNodes) {
          if (node instanceof Element) renderAll(node);
        }
      }
    }
  });

  observer.observe(root instanceof Document ? root.documentElement : (root as Node), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [attr, argsAttr, attrsAttr, richAttr, linksAttr],
  });

  return () => {
    unsubscribe();
    observer.disconnect();
  };
}

function parseArgs(raw: string | null): Params | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Params;
  } catch {
    console.warn(`[verbaly] invalid args JSON: ${raw}`);
    return undefined;
  }
}
