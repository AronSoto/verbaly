import { describe, expect, it } from 'vitest';
import { OPAQUE_BLOCKS } from '../src/emit/render';
import { COMMENT_BLOCK, MUSTACHE_BLOCK, SCRIPT_BLOCK, STYLE_BLOCK } from '../src/scan/sfc';
import { blocks, type Block, type BlockShape } from '../src/util/blocks';
import { trimTrailingSlashes } from '../src/util/text';

// records where each search starts, which is the whole cost of a scan
class Counted extends RegExp {
  starts: number[] = [];
  override exec(text: string): RegExpExecArray | null {
    this.starts.push(this.lastIndex);
    return super.exec(text);
  }
}

// a fixed seed, so a failure names the same input on every run
function corpus(pieces: string[], count: number): string[] {
  let seed = 7;
  const next = (bound: number): number => (seed = (seed * 48271) % 2147483647) % bound;
  return Array.from({ length: count }, () =>
    Array.from({ length: next(17) }, () => pieces[next(pieces.length)]!).join(''),
  );
}

// what the regex matched, in the offsets a block carries: its groups are open, body and close
function matched(text: string, re: RegExp): Block[] {
  return [...text.matchAll(re)].map((m) => {
    const body = m.index + m[1]!.length;
    return { start: m.index, body, close: body + m[2]!.length, end: m.index + m[0].length };
  });
}

const SFC_PIECES = [
  '<script',
  '<SCRIPT',
  '<scripts',
  '<script>',
  ' lang="ts">',
  '>',
  '</script>',
  '</script >',
  '</script',
  '</SCRIPT\n>',
  '</script\v>',
  '<style>',
  '<style',
  '</style>',
  '</style \t>',
  '<!--',
  '<!-->',
  '-->',
  '--',
  '-',
  '{{',
  '{{{',
  '}}',
  '{',
  '}',
  'a',
  ' ',
  '\n',
  '\u00a0',
  '<',
  '/',
  '!',
];

describe('blocks, the scan that replaced the lazy regexes', () => {
  // Proved able to fail by retrying the next open after a missing close: 10000 searches, not 2.
  it('stops at the first open that has no close, however many follow it', () => {
    const open = new Counted('<!--', 'g');
    const close = new Counted('-->', 'g');
    expect(blocks('<!--'.repeat(10_000), [{ open, close }])).toEqual([]);
    expect([...open.starts, ...close.starts]).toEqual([0, 4]);
  });

  it('starts every search where the one before it ended, so no character is read twice', () => {
    const open = new Counted('\\{\\{', 'g');
    const close = new Counted('\\}\\}', 'g');
    expect(blocks('{{a}} {{b}} {{c', [{ open, close }])).toHaveLength(2);
    expect(open.starts).toEqual([0, 5, 11]);
    expect(close.starts).toEqual([2, 8, 14]);
  });

  // the regexes sfc.ts held, text for text, with their parts in groups: open, body, close
  it.each([
    ['script', SCRIPT_BLOCK, String.raw`(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)`, 'gi'],
    ['style', STYLE_BLOCK, String.raw`(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)`, 'gi'],
    ['comment', COMMENT_BLOCK, String.raw`(<!--)([\s\S]*?)(-->)`, 'g'],
    ['mustache', MUSTACHE_BLOCK, String.raw`(\{\{)([\s\S]*?)(\}\})`, 'g'],
  ] as Array<[string, BlockShape, string, string]>)(
    'finds the %s blocks the regex it replaced in sfc.ts found, offset for offset',
    (_, shape, pattern, flags) => {
      const re = new RegExp(pattern, flags);
      const wrong = corpus(SFC_PIECES, 4000).filter(
        (text) => JSON.stringify(blocks(text, [shape])) !== JSON.stringify(matched(text, re)),
      );
      expect(wrong.slice(0, 3)).toEqual([]);
    },
  );

  // the mirror's rule written as one regex: where a browser ends a comment, a script and a style
  it('ends what the mirror leaves alone where that rule does, alternatives and all', () => {
    const rule =
      /<!--(?:-?>|[\s\S]*?--!?>)|<script\b[\s\S]*?<\/script(?=[\t\n\f\r />])[^>]*>|<style\b[\s\S]*?<\/style(?=[\t\n\f\r />])[^>]*>/gi;
    const pieces = [
      ...SFC_PIECES,
      '</script foo>',
      '</script/>',
      '</script\t\n bar>',
      '</style\f>',
      '<!--->',
      '<!---->',
      '--!>',
      '--!',
      '"',
    ];
    const span = (list: Array<{ start: number; end: number }>) =>
      JSON.stringify(list.map(({ start, end }) => [start, end]));
    const wrong = corpus(pieces, 4000).filter(
      (text) =>
        span(blocks(text, OPAQUE_BLOCKS)) !==
        span([...text.matchAll(rule)].map((m) => ({ start: m.index, end: m.index + m[0].length }))),
    );
    expect(wrong.slice(0, 3)).toEqual([]);
  });
});

describe('trimTrailingSlashes', () => {
  it('returns what /\\/+$/ did, read from the end', () => {
    const wrong = corpus(['/', '//', 'a', ' ', '\\', '?', '#', '.'], 2000).filter(
      (text) => trimTrailingSlashes(text) !== text.replace(/\/+$/, ''),
    );
    expect(wrong.slice(0, 3)).toEqual([]);
  });
});
