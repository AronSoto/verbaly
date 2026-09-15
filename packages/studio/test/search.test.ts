import { describe, expect, it } from 'vitest';
import { marked, search, toPanel } from '../src/ui/model';

const panel = toPanel({
  root: '/app',
  dir: '/app/locales',
  sourceLocale: 'en',
  locales: ['en', 'es', 'pt'],
  scanning: true,
  catalogs: {
    en: { a: 'The key to the door', b: 'Cart', c: 'Welcome {name}' },
    es: { a: 'La llave de la puerta', b: 'Clave de acceso', c: 'Bienvenido' },
    pt: { a: 'A chave da porta', b: 'Carrinho', c: 'Bem-vindo {name}' },
  },
  origins: {},
  drafts: { pt: ['b'] },
  triage: {},
  check: { broken: [{ locale: 'es', key: 'c', severity: 'error', issue: '{name} is missing' }] },
  problems: [],
});

describe('search reads every language, which is the whole reason the sheet exists', () => {
  // Proved able to fail by filtering on the ticked locales: "Clave" only lives in Spanish.
  it('finds a word that only one language has, with no language ticked anywhere', () => {
    const hits = search(panel, 'clave');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.key).toBe('b');
  });

  // Proved able to fail by dropping locales from the hit: the table already cannot say this.
  it('names the language it matched in, which is what a filtered table cannot do', () => {
    expect(search(panel, 'clave')[0]!.locales).toEqual(['es']);
    expect(search(panel, 'chave')[0]!.locales).toEqual(['pt']);
  });

  it('names every language when more than one matches, source included', () => {
    expect(search(panel, 'key')[0]!.locales).toEqual(['en']);
    expect(search(panel, 'a')[0]!.locales.length).toBeGreaterThan(1);
  });

  it('never matches the key itself, because nobody remembers a hash', () => {
    expect(search(panel, 'b')).not.toContainEqual(expect.objectContaining({ key: 'b', locales: [] }));
    expect(search(panel, 'zzz')).toEqual([]);
  });

  it('carries the state of the whole message, so the tile answers is this one fine', () => {
    expect(search(panel, 'Bienvenido')[0]!.state).toBe('broken');
    expect(search(panel, 'puerta')[0]!.state).toBe('done');
  });

  it('is case insensitive and trims, because a search box collects both', () => {
    expect(search(panel, '  CLAVE ')).toHaveLength(1);
  });

  it('answers nothing for an empty query instead of every message', () => {
    expect(search(panel, '   ')).toEqual([]);
  });

  it('stops at the limit, because a sheet shows the first few and not a report', () => {
    expect(search(panel, 'a', 1)).toHaveLength(1);
  });
});

describe('marked', () => {
  it('splits the text around what you typed, so no markup is built by hand', () => {
    expect(marked('Clave de acceso', 'clave')).toEqual(['', 'Clave', ' de acceso']);
    expect(marked('La llave', 'lave')).toEqual(['La l', 'lave', '']);
  });

  it('leaves the text whole when the needle is not in it', () => {
    expect(marked('Cart', 'zzz')).toEqual(['Cart', '', '']);
  });
});
