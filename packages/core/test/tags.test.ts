import { describe, expect, it } from 'vitest';
import { parseTags } from '../src/index';

describe('parseTags', () => {
  it('plain text', () => {
    expect(parseTags('hello')).toEqual(['hello']);
  });

  it('named tag', () => {
    expect(parseTags('a <b>bold</b> c')).toEqual(['a ', { name: 'b', children: ['bold'] }, ' c']);
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

  it('decodes entities in text runs', () => {
    expect(parseTags('set the &lt;html lang&gt; attribute')).toEqual([
      'set the <html lang> attribute',
    ]);
  });

  it('decoded entities never become tags', () => {
    expect(parseTags('&lt;em&gt;x&lt;/em&gt;')).toEqual(['<em>x</em>']);
  });

  it('decodes entities inside tag children', () => {
    expect(parseTags('<code>&lt;html&gt;</code>')).toEqual([
      { name: 'code', children: ['<html>'] },
    ]);
  });

  it('double-escaped entity decodes once', () => {
    expect(parseTags('&amp;lt;')).toEqual(['&lt;']);
  });

  it('mixes entities with real tags', () => {
    expect(parseTags('a &lt;b&gt; <b>bold</b>')).toEqual([
      'a <b> ',
      { name: 'b', children: ['bold'] },
    ]);
  });
});
