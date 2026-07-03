import {
  computed,
  inject,
  onScopeDispose,
  shallowRef,
  type App,
  type InjectionKey,
  type ShallowRef,
  type WritableComputedRef,
} from 'vue';
import type { DictionaryInput, Params, TFunction, Verbaly } from 'verbaly';

const KEY: InjectionKey<Verbaly> = Symbol('verbaly');

export interface VerbalyPlugin {
  install(app: App): void;
}

export function verbalyPlugin<D extends DictionaryInput>(instance: Verbaly<D>): VerbalyPlugin {
  return {
    install(app) {
      app.provide(KEY, instance as unknown as Verbaly);
    },
  };
}

export function useVerbaly<D extends DictionaryInput = DictionaryInput>(): Verbaly<D> {
  const instance = inject(KEY, null);
  if (!instance) {
    throw new Error('[verbaly] useVerbaly requires app.use(verbalyPlugin(...))');
  }
  return instance as unknown as Verbaly<D>;
}

export function useT<D extends DictionaryInput = DictionaryInput>(): TFunction<D> {
  const instance = useVerbaly<D>();
  const version = trackVersion(instance);
  const t = (first: unknown, ...rest: unknown[]): string => {
    void version.value;
    return (instance.t as unknown as (...args: unknown[]) => string)(first, ...rest);
  };
  return t as TFunction<D>;
}

export function useLocale(): WritableComputedRef<string> {
  const instance = useVerbaly();
  const version = trackVersion(instance);
  return computed({
    get: () => {
      void version.value;
      return instance.locale;
    },
    set: (locale: string) => instance.setLocale(locale),
  });
}

function trackVersion<D extends DictionaryInput>(instance: Verbaly<D>): ShallowRef<number> {
  const version = shallowRef(instance.version);
  onScopeDispose(
    instance.subscribe(() => {
      version.value = instance.version;
    }),
  );
  return version;
}

export type { Params, TFunction, Verbaly };
