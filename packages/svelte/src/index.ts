import { getContext, setContext } from 'svelte';
import type { Readable, Writable } from 'svelte/store';
import {
  persistLocale,
  type DictionaryInput,
  type Params,
  type TFunction,
  type Verbaly,
} from 'verbaly';

const KEY = {};

export function provideVerbaly<D extends DictionaryInput>(instance: Verbaly<D>): Verbaly<D> {
  setContext(KEY, instance);
  return instance;
}

// what verbaly/app registers in a browser; a server holds one instance per request instead
const APP_INSTANCE = Symbol.for('verbaly.app');

function appInstance<D extends DictionaryInput>(): Verbaly<D> | undefined {
  if (typeof document === 'undefined') return undefined;
  return (globalThis as Record<symbol, unknown>)[APP_INSTANCE] as Verbaly<D> | undefined;
}

// a parent's wins; without one, a browser or a test reads the app's own instance
export function useVerbaly<D extends DictionaryInput = DictionaryInput>(): Verbaly<D> {
  const instance = getContext<Verbaly<D> | undefined>(KEY) ?? appInstance<D>();
  if (!instance) {
    throw new Error(
      '[verbaly] useVerbaly requires provideVerbaly(...) in a parent: on a server, or before verbaly/app loads',
    );
  }
  return instance;
}

// store factories: also usable without context (app-level singleton)
export function tStore<D extends DictionaryInput>(instance: Verbaly<D>): Readable<Verbaly<D>['t']> {
  return {
    subscribe(run) {
      run(instance.t);
      return instance.subscribe(() => run(instance.t));
    },
  };
}

export function localeStore(instance: Verbaly): Writable<string> {
  // synchronous, so the last write wins; the page follows: <html lang>, dir and the stored choice
  const set = (locale: string): void => {
    instance.setLocale(locale);
    persistLocale(locale);
  };
  return {
    subscribe(run) {
      run(instance.locale);
      return instance.subscribe(() => run(instance.locale));
    },
    set,
    update: (fn) => set(fn(instance.locale)),
  };
}

// typed by the project's catalog once verbaly.d.ts exists, by a dictionary when one is named
export function useT<D extends DictionaryInput = DictionaryInput>(): Readable<Verbaly<D>['t']> {
  return tStore(useVerbaly<D>());
}

export function useLocale(): Writable<string> {
  return localeStore(useVerbaly());
}

export type { Params, TFunction, Verbaly };
