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

// one attribute guard for bindDom + render, a catalog is untrusted input: undefined = skip
export function safeAttribute(name: string, value: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || BLOCKED_ATTR.test(lower)) return undefined;
  if (URL_ATTR.test(lower)) return safeHref(value);
  return value;
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
  const argsCache = new WeakMap<Element, { raw: string | null; value: Params | undefined }>();
  const linksCache = new WeakMap<
    Element,
    { raw: string | null; value: Record<string, RichLink> | undefined }
  >();
  const attrsCache = new WeakMap<Element, { raw: string | null; value: Params | undefined }>();

  function fromCache<T>(
    cache: WeakMap<Element, { raw: string | null; value: T }>,
    el: Element,
    raw: string | null,
    compute: () => T,
  ): T {
    const hit = cache.get(el);
    if (hit && hit.raw === raw) return hit.value;
    const value = compute();
    cache.set(el, { raw, value });
    return value;
  }

  function cachedArgs(el: Element): Params | undefined {
    const raw = el.getAttribute(argsAttr);
    return fromCache(argsCache, el, raw, () => parseArgs(raw));
  }

  function cachedLinks(el: Element): Record<string, RichLink> | undefined {
    const raw = el.getAttribute(linksAttr);
    if (!raw) return globalLinks;
    return fromCache(linksCache, el, raw, () => {
      const own = parseArgs(raw) as Record<string, RichLink> | undefined;
      return own ? (globalLinks ? { ...globalLinks, ...own } : own) : globalLinks;
    });
  }

  function renderRich(
    el: Element,
    nodes: TagNode[],
    links: Record<string, RichLink> | undefined,
  ): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        el.append(node);
        continue;
      }
      const link = links?.[node.name];
      if (link !== undefined) {
        const { href, target, rel } = normalizeLink(link);
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
    const attrMap = fromCache(attrsCache, el, rawAttrs, () => parseArgs(rawAttrs));
    if (attrMap) {
      for (const [name, attrKey] of Object.entries(attrMap)) {
        if (typeof attrKey !== 'string') continue;
        const value = safeAttribute(name, t(attrKey, args));
        if (value !== undefined) el.setAttribute(name, value);
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
