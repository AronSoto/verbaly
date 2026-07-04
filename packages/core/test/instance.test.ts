import { describe, expect, it, vi } from 'vitest';
import { createVerbaly } from '../src/instance';
import type { DictionaryInput } from '../src/types';

describe('locale resolution', () => {
  it('narrows BCP-47 subtags', () => {
    const v = createVerbaly({
      locale: 'es-MX',
      messages: { es: { hello: 'Hola' } },
    });
    expect(v.t('hello')).toBe('Hola');
  });

  it('walks the fallback chain', () => {
    const v = createVerbaly({
      locale: 'pt',
      fallback: ['es', 'en'],
      messages: { en: { onlyEn: 'English only' }, es: {}, pt: {} },
    });
    expect(v.t('onlyEn')).toBe('English only');
  });

  it('recomputes the chain after setLocale', () => {
    const v = createVerbaly({
      locale: 'es-MX',
      messages: { es: { a: 'Hola' }, 'pt-BR': { a: 'Oi' }, pt: { b: 'Base' } },
    });
    expect(v.t('a')).toBe('Hola');
    v.setLocale('pt-BR');
    expect(v.t('a')).toBe('Oi');
    expect(v.t('b')).toBe('Base');
  });

  it('reports key existence', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { a: 'x' } } });
    expect(v.has('a')).toBe(true);
    expect(v.has('b')).toBe(false);
  });

  it('lists loaded locales', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: { a: 'x' }, en: { a: 'y' } } });
    expect(v.locales).toEqual(['es', 'en']);
    v.addMessages('pt', { a: 'z' });
    expect(v.locales).toEqual(['es', 'en', 'pt']);
  });
});

describe('missing keys', () => {
  it('returns the key and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly<DictionaryInput>({ locale: 'es', messages: { es: {} } });
    expect(v.t('nope')).toBe('nope');
    expect(v.t('nope')).toBe('nope');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('delegates to onMissing', () => {
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      messages: { es: {} },
      onMissing: (key) => `[${key}]`,
    });
    expect(v.t('nope')).toBe('[nope]');
  });
});

describe('reactivity', () => {
  it('notifies on locale change', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    const listener = vi.fn();
    v.subscribe(listener);
    v.setLocale('en');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(v.locale).toBe('en');
  });

  it('bumps version on every change', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    expect(v.version).toBe(0);
    v.setLocale('en');
    v.addMessages('pt', { a: 'A' });
    expect(v.version).toBe(2);
  });

  it('skips notify when locale unchanged', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    const listener = vi.fn();
    v.subscribe(listener);
    v.setLocale('es');
    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies on addMessages and merges', () => {
    const v = createVerbaly<DictionaryInput>({ locale: 'pt', messages: { pt: { a: 'A' } } });
    const listener = vi.fn();
    v.subscribe(listener);
    v.addMessages('pt', { b: 'B' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(v.t('a')).toBe('A');
    expect(v.t('b')).toBe('B');
  });

  it('unsubscribes', () => {
    const v = createVerbaly({ locale: 'es', messages: { es: {} } });
    const listener = vi.fn();
    const unsub = v.subscribe(listener);
    unsub();
    v.setLocale('en');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('nested messages', () => {
  it('flattens dotted keys', () => {
    const v = createVerbaly({
      locale: 'es',
      messages: { es: { home: { title: 'Inicio', nav: { back: 'Volver' } } } },
    });
    expect(v.t('home.title')).toBe('Inicio');
    expect(v.t('home.nav.back')).toBe('Volver');
  });
});

describe('tagged template', () => {
  it('interpolates source text', () => {
    const v = createVerbaly({ locale: 'en', messages: { en: {} } });
    const name = 'Aron';
    const count = 1234.5;
    expect(v.t`Hello ${name}, ${count} points`).toBe('Hello Aron, 1,234.5 points');
  });
});
