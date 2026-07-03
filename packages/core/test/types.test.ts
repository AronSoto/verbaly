import { describe, expect, it, vi } from 'vitest';
import { createVerbaly } from '../src/instance';

const v = createVerbaly({
  locale: 'es',
  messages: {
    es: {
      plain: 'Hola',
      greet: 'Hola {name}',
      inbox: '{count | =0: nada | one: uno | other: # cosas}',
      nested: { deep: 'Nivel {level}' },
      escaped: 'Usa {{clave}} aquí',
    },
  },
});

describe('type-level params', () => {
  it('accepts paramless keys without args', () => {
    expect(v.t('plain')).toBe('Hola');
  });

  it('requires declared params', () => {
    expect(v.t('greet', { name: 'Aron' })).toBe('Hola Aron');
    // @ts-expect-error params required
    v.t('greet');
  });

  it('detects params inside variants', () => {
    expect(v.t('inbox', { count: 0 })).toBe('nada');
  });

  it('walks nested keys', () => {
    expect(v.t('nested.deep', { level: 2 })).toBe('Nivel 2');
  });

  it('ignores escaped braces', () => {
    expect(v.t('escaped')).toBe('Usa {clave} aquí');
  });

  it('rejects unknown keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // @ts-expect-error unknown key
    expect(v.t('nope')).toBe('nope');
    warn.mockRestore();
  });

  it('rejects extra args on paramless keys', () => {
    // @ts-expect-error no params declared
    v.t('plain', { x: 1 });
  });
});
