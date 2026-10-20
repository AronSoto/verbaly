import { describe, expect, it, vi } from 'vitest';
import { createVerbaly, type Params } from '../src/index';
import { parse } from '../src/parse';

describe('parse edge cases', () => {
  it('keeps an unclosed brace as literal text', () => {
    expect(parse('Hola {name')).toEqual([{ kind: 'text', value: 'Hola {name' }]);
  });

  it('treats an empty placeholder as text', () => {
    expect(parse('{}')).toEqual([{ kind: 'text', value: '{}' }]);
  });

  it('treats a nameless placeholder as text', () => {
    expect(parse('{ : number}')).toEqual([{ kind: 'text', value: '{ : number}' }]);
  });

  it('skips variant segments without a colon', () => {
    const [node] = parse('{n | one: uno | rota | other: # x}');
    expect(node).toMatchObject({ kind: 'param', name: 'n' });
    const variants = (node as { variants: [string, unknown][] }).variants;
    expect(variants.map(([key]) => key)).toEqual(['one', 'other']);
  });

  it('keeps escaped braces inside variant bodies', () => {
    const [node] = parse('{n | other: usa {{clave}} aquí}');
    const variants = (node as { variants: [string, { kind: string; value?: string }[]][] })
      .variants;
    expect(variants[0]![1]).toEqual([{ kind: 'text', value: 'usa {clave} aquí' }]);
  });

  it('escapes ## inside variants and keeps single # as hash', () => {
    const [node] = parse('{n | other: ## #}');
    const variants = (node as { variants: [string, { kind: string; value?: string }[]][] })
      .variants;
    expect(variants[0]![1]).toEqual([{ kind: 'text', value: '# ' }, { kind: 'hash' }]);
  });

  it('trims format and argument around the slash', () => {
    expect(parse('{d: date / long }')).toEqual([
      { kind: 'param', name: 'd', format: 'date', arg: 'long' },
    ]);
  });
});

describe('blocks that close together', () => {
  const render = (message: string, params: Params) =>
    createVerbaly({ locale: 'es', messages: { es: { m: message } } }).t('m', params);

  it('reads }} as two closes when reading it as an escape leaves the block open', () => {
    const guests =
      '{g | f: {c | one: # invitada | other: # invitadas} | other: {c | one: # invitado | other: # invitados}}';
    expect(render(guests, { g: 'f', c: 2 })).toBe('2 invitadas');
    expect(render(guests, { g: 'm', c: 1 })).toBe('1 invitado');
    const three = '{a | x: {b | y: {c | one: uno | other: varios}}}';
    expect(render(three, { a: 'x', b: 'y', c: 1 })).toBe('uno');
    // the }} in the middle closes two blocks, so the variant after it still belongs to a
    const middle = '{a | x: {b | y: {c | one: una | other: varias}} | other: ninguna}';
    expect(render(middle, { a: 'x', b: 'y', c: 2 })).toBe('varias');
    expect(render(middle, { a: 'w', b: 'y', c: 2 })).toBe('ninguna');
  });

  it('closes two blocks with }} only where two are open, so an escape elsewhere stays one', () => {
    const mixed = '{a | x: lit }} here | y: {b | one: uno | other: varios}}';
    expect(render(mixed, { a: 'x', b: 1 })).toBe('lit } here');
    expect(render(mixed, { a: 'y', b: 2 })).toBe('varios');
    // an unclosed brace stays text even when an escaped }} follows it
    expect(render('Escribe {nombre y luego {{x}}', {})).toBe('Escribe {nombre y luego {{x}}');
    expect(render('{a}} texto', { a: 1 })).toBe('{a}} texto');
  });

  it('keeps }} an escaped brace wherever the block closes without it', () => {
    // migrate doubles a lone } inside a block, and those catalogs render as they always did
    expect(render('{count | one: a }} b | other: c }} d}', { count: 1 })).toBe('a } b');
    expect(render('Escribe {{nombre}} tal cual, {n}', { n: 1 })).toBe(
      'Escribe {nombre} tal cual, 1',
    );
  });
});

describe('AST cache cap', () => {
  it('keeps working past the cap and returns identical ASTs for repeats', () => {
    const first = parse('cap {n}');
    // overflow the cap: entries are evicted, parse must stay correct
    for (let i = 0; i < 5100; i++) parse(`filler ${i} {n}`);
    const again = parse('cap {n}');
    expect(again).toEqual(first);
    expect(parse('filler 0 {n}')).toEqual([
      { kind: 'text', value: 'filler 0 ' },
      { kind: 'param', name: 'n' },
    ]);
  });

  it('drops the oldest message past the cap and keeps the newest', () => {
    const oldest = parse('fifo oldest {n}');
    for (let i = 0; i < 5000; i++) parse(`fifo filler ${i} {n}`);
    const newest = parse('fifo newest {n}');
    for (let i = 0; i < 10; i++) parse(`fifo after ${i} {n}`);
    expect(parse('fifo oldest {n}')).not.toBe(oldest);
    expect(parse('fifo newest {n}')).toBe(newest);
  });

  // a new iterator starts at the front of the table and walks every hole the earlier drops left
  it('drops the oldest without starting a new walk of the cache each time', () => {
    for (let i = 0; i < 5100; i++) parse(`walk filler ${i} {n}`);
    const keys = vi.spyOn(Map.prototype, 'keys');
    try {
      for (let i = 0; i < 200; i++) parse(`walk past the cap ${i} {n}`);
      expect(keys).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
    }
  });
});
