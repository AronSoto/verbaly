import { parseTags, type TagNode } from './tags';
import type { DictionaryInput, Params, Verbaly } from './types';

export interface BindDomOptions {
  root?: ParentNode;
  attribute?: string;
  richTags?: string[];
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
  const richTags = new Set(options.richTags ?? RICH_TAGS);
  const argsCache = new WeakMap<Element, { raw: string | null; params: Params | undefined }>();

  function cachedArgs(el: Element): Params | undefined {
    const raw = el.getAttribute(argsAttr);
    const hit = argsCache.get(el);
    if (hit && hit.raw === raw) return hit.params;
    const params = parseArgs(raw);
    argsCache.set(el, { raw, params });
    return params;
  }

  function renderRich(el: Element, nodes: TagNode[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        el.append(node);
      } else if (richTags.has(node.name)) {
        const child = el.ownerDocument.createElement(node.name);
        renderRich(child, node.children);
        el.append(child);
      } else {
        renderRich(el, node.children); // unknown tag → unwrap
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
        renderRich(el, parseTags(text));
      } else {
        el.textContent = text;
      }
    }

    const attrMap = parseArgs(el.getAttribute(attrsAttr));
    if (attrMap) {
      for (const [name, attrKey] of Object.entries(attrMap)) {
        if (typeof attrKey !== 'string' || name.toLowerCase().startsWith('on')) continue;
        el.setAttribute(name, t(attrKey, args));
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
    attributeFilter: [attr, argsAttr, attrsAttr, richAttr],
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
