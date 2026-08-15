import { describe, expect, it } from 'vitest';
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
});
