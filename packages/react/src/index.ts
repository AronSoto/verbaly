import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { DictionaryInput, TFunction, Verbaly } from 'verbaly';

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
