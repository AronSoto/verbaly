import { cloneElement, createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import {
  normalizeLink,
  parseTags,
  RICH_TAGS,
  VOID_TAGS,
  type Params,
  type RichLink,
  type TagNode,
  type Verbaly,
} from 'verbaly';

// everything a <Trans> takes besides its message: one contract for the client and the server
export interface TransOptions {
  values?: Params;
  instance?: Verbaly;
  components?: Record<string, ReactElement>;
  richTags?: string[];
  links?: Record<string, RichLink>;
}

// an id at runtime; children in the source, which the compiler turns into an id and its props
export type TransProps = TransOptions &
  ({ id: string; children?: undefined } | { id?: undefined; children: ReactNode });

// no hook and no context in here, so a Server Component renders it as well as a client one
export function renderTrans(instance: Verbaly, props: TransProps): ReactElement {
  // never compiled (no plugin, or a file outside include): the source text, like an uncompiled t`…`
  if (props.id === undefined) return createElement(Fragment, null, props.children);
  const text = (instance.t as unknown as (id: string, values?: Params) => string)(
    props.id,
    props.values,
  );
  return createElement(
    Fragment,
    null,
    ...toNodes(
      parseTags(text),
      props.components ?? {},
      props.links ?? {},
      new Set(props.richTags ?? RICH_TAGS),
    ),
  );
}

const VOID = new Set(VOID_TAGS);

// own entries only: a tag named constructor in a message must never find the one on Object
function own<T>(map: Record<string, T>, name: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
}

function toNodes(
  nodes: TagNode[],
  components: Record<string, ReactElement>,
  links: Record<string, RichLink>,
  richTags: Set<string>,
): ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === 'string') return node;
    const children = toNodes(node.children, components, links, richTags);
    const el = own(components, node.name);
    if (el) return cloneElement(el, { key: i }, ...children);
    const link = own(links, node.name);
    if (link !== undefined) {
      return createElement('a', { key: i, ...normalizeLink(link) }, ...children);
    }
    if (richTags.has(node.name)) {
      if (VOID.has(node.name)) return createElement(node.name, { key: i });
      return createElement(node.name, { key: i }, ...children);
    }
    return createElement(Fragment, { key: i }, ...children);
  });
}
