import { describe, expect, it } from 'vitest';
import { validatePair } from '@verbaly/compiler';
import { preview } from '../src/ui/validate';

const problems = (source: string, translated: string) => preview(source, translated).problems;
const chips = (source: string, translated: string) =>
  preview(source, translated).params.map((p) => `${p.name}:${p.inSource ? 's' : ''}${p.inTarget ? 't' : ''}`);

describe('what the editor says while you type', () => {
  it('says nothing when the translation keeps what the source had', () => {
    expect(problems('Hi {name}', 'Hola {name}')).toEqual([]);
    expect(problems('Plain text', 'Texto plano')).toEqual([]);
  });

  // Proved able to fail by dropping the lost-param branch: it saves, the build breaks later.
  it('names the param that did not survive', () => {
    expect(problems('Hi {name}', 'Hola')).toEqual([
      '{name} is missing, so its value never reaches the text',
    ]);
  });

  it('names a param the translation invented, which would render literally', () => {
    expect(problems('Hi there', 'Hola {name}')).toEqual([
      '{name} is not in the source, so it renders as literal text',
    ]);
  });

  it('lists both when both happened, in one sentence each', () => {
    expect(problems('{a} and {b}', '{c}')).toHaveLength(2);
  });

  // Proved able to fail by dropping the selector check: some counts render empty and nothing warns.
  it('catches a plural block that lost its catch-all', () => {
    expect(problems('{n | one: one | other: # many}', '{n | one: uno}')).toContain(
      'the block for {n} has no "other" case, so some counts render empty',
    );
    expect(problems('{n | one: one | other: # many}', '{n | one: uno | other: # muchos}')).toEqual([]);
  });

  // Proved able to fail by comparing tags as a set: one of the two survives and nothing says so.
  it('counts the tags, so a lost one and a doubled one both show', () => {
    expect(problems('a <em>b</em> c', 'a b c')).toEqual(['<em> is missing from the translation']);
    expect(problems('<em>a</em> and <em>b</em>', '<em>a</em> and b')).toEqual([
      '<em> is missing from the translation',
    ]);
    expect(problems('a <em>b</em>', 'a <em>b</em> <em>c</em>')).toEqual([
      '<em> is not in the source message',
    ]);
  });

  it('reads a tag nested inside another one', () => {
    expect(problems('<strong>a <em>b</em></strong>', '<strong>a b</strong>')).toEqual([
      '<em> is missing from the translation',
    ]);
  });

  // A half-typed message is a normal state of an editor, not a defect to shout about.
  it('stays quiet on a message that is still being typed', () => {
    expect(() => preview('Hi {name}', 'Hola {na')).not.toThrow();
  });
});

describe('the chips, which are how you see a param survive', () => {
  it('marks each param with the sides it appears on', () => {
    expect(chips('Hi {name}', 'Hola {name}')).toEqual(['name:st']);
    expect(chips('Hi {name}', 'Hola')).toEqual(['name:s']);
    expect(chips('Hi', 'Hola {name}')).toEqual(['name:t']);
  });

  it('sorts them, so the row does not reshuffle as you type', () => {
    expect(chips('{b} {a}', '{a} {b}')).toEqual(['a:st', 'b:st']);
  });

  it('sees the param a plural block is keyed on', () => {
    expect(chips('{n | one: one | other: # many}', '{n | one: uno | other: # muchos}')).toEqual([
      'n:st',
    ]);
  });
});

// The whole point of using the runtime's parser is that there is no second grammar to drift.
describe('the preview never contradicts the gate that will run on the server', () => {
  const PAIRS: [string, string][] = [
    ['Hi {name}', 'Hola {name}'],
    ['Hi {name}', 'Hola'],
    ['Hi there', 'Hola {name}'],
    ['{a} and {b}', '{c}'],
    ['a <em>b</em> c', 'a b c'],
    ['a <em>b</em>', 'a <em>b</em> <em>c</em>'],
    ['<strong>a <em>b</em></strong>', '<strong>a b</strong>'],
    ['<em>a</em> and <em>b</em>', '<em>a</em> and b'],
    ['Plain text', 'Texto plano'],
    ['{n | one: one | other: # many}', '{n | one: uno | other: # muchos}'],
    ['Total {amount:currency/EUR}', 'Total {amount:currency/EUR}'],
    ['Total {amount:currency/EUR}', 'Total'],
  ];

  it.each(PAIRS)('agrees on %j -> %j', (source, translated) => {
    const mine = preview(source, translated).problems.length > 0;
    const gate = validatePair(source, translated).some((i) => i.severity === 'error');
    expect(mine).toBe(gate);
  });
});
