// runs in the default node environment — no document/navigator/localStorage (SSR/Node)
import { describe, expect, it } from 'vitest';
import { bindDom } from '../src/dom';
import { attachDevtools } from '../src/devtools';
import { createVerbaly } from '../src/instance';
import { persistLocale, resolveLocale } from '../src/locale';
import type { DictionaryInput } from '../src/types';

describe('server-side (Node)', () => {
  it('has no DOM (document) — the browser discriminator', () => {
    // Node 21+ exposes a global navigator, so document is the reliable "is browser" guard
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });

  it('createVerbaly + t work per request without a DOM', () => {
    const v = createVerbaly<DictionaryInput>({
      locale: 'es',
      fallback: 'en',
      messages: {
        en: { items: '{n | one: # item | other: # items}' },
        es: { items: '{n | one: # artículo | other: # artículos}' },
      },
    });
    expect(v.t('items', { n: 2 })).toBe('2 artículos');
    // a second, independent request-scoped instance
    const en = createVerbaly<DictionaryInput>({ locale: 'en', messages: { en: { items: 'x' } } });
    expect(en.locale).toBe('en');
    expect(v.locale).toBe('es'); // instances don't share state
  });

  it('defaults locale to en when navigator is absent', () => {
    expect(createVerbaly().locale).toBe('en');
  });

  it('resolveLocale falls back without navigator/storage', () => {
    expect(resolveLocale({ supported: ['en', 'es'], fallback: 'en' })).toBe('en');
  });

  it('persistLocale is a no-op (no throw) without document', () => {
    expect(() => persistLocale('es')).not.toThrow();
  });

  it('DOM-only APIs throw a clear error server-side', () => {
    expect(() => bindDom(createVerbaly())).toThrow('requires a DOM');
    expect(() => attachDevtools(createVerbaly())).toThrow('requires a DOM');
  });
});
