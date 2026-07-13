import { getContext, setContext } from 'svelte';
import type { Readable, Writable } from 'svelte/store';
import type { DictionaryInput, Params, TFunction, Verbaly } from 'verbaly';

const KEY = {};

export function provideVerbaly<D extends DictionaryInput>(instance: Verbaly<D>): Verbaly<D> {
  setContext(KEY, instance);
  return instance;
}

export function useVerbaly<D extends DictionaryInput = DictionaryInput>(): Verbaly<D> {
  const instance = getContext<Verbaly<D> | undefined>(KEY);
  if (!instance) {
    throw new Error('[verbaly] useVerbaly requires provideVerbaly(...) in a parent component');
  }
  return instance;
}

// store factories: also usable without context (app-level singleton)
export function tStore<D extends DictionaryInput>(instance: Verbaly<D>): Readable<TFunction<D>> {
  return {
    subscribe(run) {
      run(instance.t);
      return instance.subscribe(() => run(instance.t));
    },
  };
}

export function localeStore(instance: Verbaly): Writable<string> {
  return {
    subscribe(run) {
      run(instance.locale);
      return instance.subscribe(() => run(instance.locale));
    },
    set: (locale) => instance.setLocale(locale),
    update: (fn) => instance.setLocale(fn(instance.locale)),
  };
}

export function useT<D extends DictionaryInput = DictionaryInput>(): Readable<TFunction<D>> {
  return tStore(useVerbaly<D>());
}

export function useLocale(): Writable<string> {
  return localeStore(useVerbaly());
}

export type { Params, TFunction, Verbaly };
