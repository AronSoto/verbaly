import { describe, expect, it } from 'vitest';
import { parseTags } from '../src/index';

describe('parseTags', () => {
  it('plain text', () => {
    expect(parseTags('hello')).toEqual(['hello']);
  });

  it('named tag', () => {
    expect(parseTags('a <b>bold</b> c')).toEqual([
      'a ',
      { name: 'b', children: ['bold'] },
      ' c',
    ]);
  });

  it('nested tags', () => {
    expect(parseTags('<a><b>x</b></a>')).toEqual([
      { name: 'a', children: [{ name: 'b', children: ['x'] }] },
    ]);
  });

  it('self-closing tag', () => {
    expect(parseTags('a<br/>b')).toEqual(['a', { name: 'br', children: [] }, 'b']);
  });

  it('unclosed tag → keeps inner content, drops wrapper', () => {
    expect(parseTags('a <b>bold')).toEqual(['a ', 'bold']);
  });

  it('stray closing tag → literal', () => {
    expect(parseTags('a</b>b')).toEqual(['a', '</b>', 'b']);
  });
});
