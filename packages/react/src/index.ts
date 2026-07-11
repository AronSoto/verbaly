import {
  cloneElement,
  createContext,
  createElement,
  Fragment,
  useContext,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  normalizeLink,
  parseTags,
  type DictionaryInput,
  type Params,
  type RichLink,
  type TagNode,
  type TFunction,
  type Verbaly,
} from 'verbaly';

const VerbalyContext = createContext<Verbaly | null>(null);

export interface VerbalyProviderProps<D extends DictionaryInput> {
  instance: Verbaly<D>;
  children?: ReactNode;
}

export function VerbalyProvider<D extends DictionaryInput>(
  props: VerbalyProviderProps<D>,
): ReactElement {
  return createElement(
    VerbalyContext.Provider,
    { value: props.instance as unknown as Verbaly },
    props.children,
  );
}

export function useVerbaly<D extends DictionaryInput = DictionaryInput>(): Verbaly<D> {
  const instance = useContext(VerbalyContext);
  if (!instance) {
    throw new Error('[verbaly] useVerbaly requires a <VerbalyProvider>');
  }
  return instance as unknown as Verbaly<D>;
}

export function useT<D extends DictionaryInput = DictionaryInput>(): TFunction<D> {
  const instance = useVerbaly<D>();
  useVersion(instance);
  return instance.t;
}

export function useLocale(): [string, (locale: string) => void] {
  const instance = useVerbaly();
  useVersion(instance);
  return [instance.locale, instance.setLocale];
}

function useVersion<D extends DictionaryInput>(instance: Verbaly<D>): void {
  useSyncExternalStore(
    instance.subscribe,
    () => instance.version,
    () => instance.version,
  );
}

export interface TransProps {
  id: string;
  values?: Params;
  components?: Record<string, ReactElement>;
  links?: Record<string, RichLink>;
}

// translated message + element interpolation
export function Trans(props: TransProps): ReactElement {
  const t = useT();
  const text = (t as unknown as (id: string, values?: Params) => string)(props.id, props.values);
  return createElement(
    Fragment,
    null,
    ...toNodes(parseTags(text), props.components ?? {}, props.links ?? {}),
  );
}

function toNodes(
  nodes: TagNode[],
  components: Record<string, ReactElement>,
  links: Record<string, RichLink>,
): ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === 'string') return node;
    const children = toNodes(node.children, components, links);
    const el = components[node.name];
    if (el) return cloneElement(el, { key: i }, ...children);
    const link = links[node.name];
    if (link !== undefined) {
      return createElement('a', { key: i, ...normalizeLink(link) }, ...children);
    }
    return createElement(Fragment, { key: i }, ...children);
  });
}

export type { Params, TFunction, Verbaly };
