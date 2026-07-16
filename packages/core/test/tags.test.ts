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

  it('decodes decimal entities', () => {
    expect(parseTags('a &#123;b&#125; c')).toEqual(['a {b} c']);
  });

  it('decodes hex entities, case-insensitive', () => {
    expect(parseTags('&#x7B;x&#X7d;')).toEqual(['{x}']);
  });

  it('decodes numeric entities inside tag children', () => {
    expect(parseTags('<code>&#123;when:relative&#125;</code>')).toEqual([
      { name: 'code', children: ['{when:relative}'] },
    ]);
  });

  it('numeric angle brackets never become tags', () => {
    expect(parseTags('&#60;em&#62;x&#60;/em&#62;')).toEqual(['<em>x</em>']);
  });

  it('double-escaped numeric entity decodes once', () => {
    expect(parseTags('&amp;#123;')).toEqual(['&#123;']);
  });

  it('out-of-range code point stays literal', () => {
    expect(parseTags('&#x110000;')).toEqual(['&#x110000;']);
  });

  it('malformed numeric refs stay literal', () => {
    expect(parseTags('&#; &#x; &#12')).toEqual(['&#; &#x; &#12']);
  });
});
