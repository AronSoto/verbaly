import type { DictionaryInput, Params, Verbaly } from './types';

export interface BindDomOptions {
  root?: ParentNode;
  attribute?: string;
}

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

  function render(el: Element): void {
    const args = parseArgs(el.getAttribute(argsAttr));
    const key = el.getAttribute(attr);
    if (key) el.textContent = t(key, args);

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
    attributeFilter: [attr, argsAttr, attrsAttr],
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
