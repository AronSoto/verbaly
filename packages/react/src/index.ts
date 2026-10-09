import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { DictionaryInput, Params, TFunction, Verbaly } from 'verbaly';
import { renderTrans, type TransProps } from './render';

export type { TransOptions, TransProps } from './render';

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

// typed by the project's catalog once verbaly.d.ts exists, by a dictionary when one is named
export function useT<D extends DictionaryInput = DictionaryInput>(): Verbaly<D>['t'] {
  const instance = useVerbaly<D>();
  const version = useVersion(instance);
  // a new t per locale or catalog: a memo or an effect keyed on t would keep the old language
  return useMemo(() => bound(instance.t), [instance, version]);
}

function bound<T extends Pick<TFunction, 'id'>>(t: T): T {
  const call = t as unknown as (...args: unknown[]) => string;
  const fresh = ((...args: unknown[]) => call(...args)) as unknown as T;
  fresh.id = t.id;
  return fresh;
}

export function useLocale(): [string, (locale: string) => void] {
  const instance = useVerbaly();
  useVersion(instance);
  return [instance.locale, instance.setLocale];
}

function useVersion<D extends DictionaryInput>(instance: Verbaly<D>): number {
  return useSyncExternalStore(
    instance.subscribe,
    () => instance.version,
    () => instance.version,
  );
}

// translated message + element interpolation
export function Trans(props: TransProps): ReactElement {
  const ctx = useContext(VerbalyContext);
  const instance = props.instance ?? ctx;
  if (!instance) {
    throw new Error('[verbaly] <Trans> requires an instance prop or a <VerbalyProvider>');
  }
  useVersion(instance);
  return renderTrans(instance, props);
}

export type { Params, TFunction, Verbaly };
