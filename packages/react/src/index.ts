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
import type { DictionaryInput, Params, TFunction, Verbaly } from 'verbaly';

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
}

// translated message + element interpolation
export function Trans(props: TransProps): ReactElement {
  const t = useT();
  const text = (t as unknown as (id: string, values?: Params) => string)(props.id, props.values);
  return createElement(Fragment, null, ...renderTags(text, props.components ?? {}));
}

const TAG = /<(\/?)([a-zA-Z][\w-]*)(\/?)>/g;

function renderTags(text: string, components: Record<string, ReactElement>): ReactNode[] {
  const tag = new RegExp(TAG.source, 'g');
  let pos = 0;
  let key = 0;

  const walk = (stop: string | null): ReactNode[] => {
    const out: ReactNode[] = [];
    let m: RegExpExecArray | null;
    while ((m = tag.exec(text)) !== null) {
      const [full, closing, name, selfClose] = m;
      if (m.index > pos) out.push(text.slice(pos, m.index));
      pos = m.index + full.length;
      if (closing) {
        if (name === stop) return out;
        out.push(full); // stray close → literal
      } else if (selfClose) {
        const el = components[name!];
        out.push(el ? cloneElement(el, { key: key++ }) : full);
      } else {
        const children = walk(name!);
        const el = components[name!];
        if (el) out.push(cloneElement(el, { key: key++ }, ...children));
        else out.push(...children); // unknown tag → text
      }
    }
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  };
  return walk(null);
}
