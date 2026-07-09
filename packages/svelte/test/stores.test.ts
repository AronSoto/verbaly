import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { createVerbaly } from 'verbaly';
import { localeStore, tStore } from '../src/index';
import Hooks from './fixtures/Hooks.svelte';
import NoProvider from './fixtures/NoProvider.svelte';

function setup() {
  return createVerbaly({
    locale: 'es',
    messages: {
      es: { hello: 'Hola', inbox: '{count | one: un mensaje | other: # mensajes}' },
      en: { hello: 'Hello', inbox: '{count | one: one message | other: # messages}' },
    },
  });
}

describe('tStore', () => {
  it('emits t immediately', () => {
    const v = setup();
    const run = vi.fn();
    tStore(v).subscribe(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]('hello')).toBe('Hola');
  });

  it('re-emits on locale change', () => {
    const v = setup();
    const run = vi.fn();
    tStore(v).subscribe(run);
    v.setLocale('en');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]('hello')).toBe('Hello');
  });

  it('re-emits on addMessages', () => {
    const v = setup();
    const run = vi.fn();
    tStore(v).subscribe(run);
    v.addMessages('es', { bye: 'Chau' });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0]('bye')).toBe('Chau');
  });

  it('formats params through the store value', () => {
    const v = setup();
    let t: ((key: string, params?: object) => string) | undefined;
    tStore(v).subscribe((value) => {
      t = value as typeof t;
    });
    expect(t?.('inbox', { count: 3 })).toBe('3 mensajes');
  });

  it('stops after unsubscribe', () => {
    const v = setup();
    const run = vi.fn();
    const stop = tStore(v).subscribe(run);
    stop();
    v.setLocale('en');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('context hooks', () => {
  it('useT and useLocale read the provided instance', () => {
    const target = document.createElement('div');
    const app = mount(Hooks, { target, props: { instance: setup() } });
    flushSync();
    expect(target.querySelector('p')?.textContent).toBe('Hola');
    expect(target.querySelector('button')?.textContent).toBe('es');

    target.querySelector('button')?.click();
    flushSync();
    expect(target.querySelector('p')?.textContent).toBe('Hello');
    expect(target.querySelector('button')?.textContent).toBe('en');
    unmount(app);
  });

  it('useVerbaly throws without provideVerbaly', () => {
    expect(() => mount(NoProvider, { target: document.createElement('div') })).toThrow(
      /provideVerbaly/,
    );
  });
});

describe('localeStore', () => {
  it('emits the current locale immediately', () => {
    const v = setup();
    const run = vi.fn();
    localeStore(v).subscribe(run);
    expect(run).toHaveBeenCalledWith('es');
  });

  it('set switches the instance locale', () => {
    const v = setup();
    const store = localeStore(v);
    const run = vi.fn();
    store.subscribe(run);
    store.set('en');
    expect(v.locale).toBe('en');
    expect(run).toHaveBeenLastCalledWith('en');
  });

  it('update derives from the current value', () => {
    const v = setup();
    const store = localeStore(v);
    store.update((locale) => (locale === 'es' ? 'en' : 'es'));
    expect(v.locale).toBe('en');
  });

  it('stops after unsubscribe', () => {
    const v = setup();
    const run = vi.fn();
    const stop = localeStore(v).subscribe(run);
    stop();
    v.setLocale('en');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
