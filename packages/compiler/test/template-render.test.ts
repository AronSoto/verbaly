import fc from 'fast-check';
import { createVerbaly, parseIcu } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { escapedSyntax } from '../src/validate';

// a generated template knows what it must show: the compiler and the core together must show it
interface Piece {
  src: string;
  blocks: number;
  show: (count: number) => string;
  variants?: true;
  afterVariants?: boolean;
}

const EUR = new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(12.5);
const text = (s: string): Piece => ({ src: s, blocks: 0, show: () => s });

const join = (pieces: Piece[]): Piece => ({
  src: pieces.map((p) => p.src).join(''),
  blocks: pieces.reduce((n, p) => n + p.blocks, 0),
  show: (c) => pieces.map((p) => p.show(c)).join(''),
  // inside a block with variants }} is an escape, so a literal } cannot follow one: documented
  afterVariants: pieces.some(
    (p, k) => p.afterVariants || (k > 0 && p.src === '}' && pieces[k - 1]!.variants === true),
  ),
});

const { top } = fc.letrec<{ top: Piece; body: Piece; value: Piece; block: Piece }>((tie) => ({
  top: fc
    .array(
      fc.oneof(
        fc.constantFrom('a', 'b ', ' ', '{', '}', '|', ':', '#', 'one', '(', ']').map(text),
        tie('value'),
        tie('block'),
      ),
      { maxLength: 4 },
    )
    .map(join),
  body: fc
    .array(
      fc.oneof(
        { depthSize: 'small' },
        fc.constantFrom('a', 'file ', ' and ').map(text),
        tie('value'),
        tie('block'),
      ),
      {
        maxLength: 3,
      },
    )
    .map(join),
  value: fc.constantFrom<Piece>(
    { src: '${count}', blocks: 0, show: (c) => String(c) },
    { src: '${name}', blocks: 0, show: () => 'Ana' },
  ),
  block: fc.oneof(
    fc.tuple(tie('body'), tie('body')).map(([one, other]): Piece => ({
      src: `{\${count} | one: ${one.src}# x | other: ${other.src}# xs}`,
      blocks: 1 + one.blocks + other.blocks,
      show: (c) => (c === 1 ? `${one.show(c)}${c} x` : `${other.show(c)}${c} xs`),
      variants: true,
      afterVariants: one.afterVariants || other.afterVariants,
    })),
    fc.tuple(tie('body'), tie('body')).map(([admin, other]): Piece => ({
      src: `{\${role} | admin: ${admin.src} | other: ${other.src}}`,
      blocks: 1 + admin.blocks + other.blocks,
      show: (c) => admin.show(c),
      variants: true,
      afterVariants: admin.afterVariants || other.afterVariants,
    })),
    fc.constant<Piece>({ src: '{${total}:currency/EUR}', blocks: 1, show: () => EUR }),
  ),
}));

function render(piece: Piece, count: number) {
  const tagged = analyze(`t\`${piece.src}\`;`, 'app.ts').tagged[0];
  if (!tagged) return undefined;
  const v = createVerbaly({ locale: 'en', messages: { en: { m: tagged.message } }, icu: parseIcu });
  const shown = v.t('m', { count, role: 'admin', total: 12.5, name: 'Ana' });
  return { message: tagged.message, shown };
}

// where a variant's edge spaces go is the catalog syntax's call: compare the content only
const content = (s: string) => s.replace(/\s+/g, '');

describe('a tagged template, extracted and rendered', () => {
  it('shows exactly what it says, or names why it cannot', () => {
    fc.assert(
      fc.property(top, (piece) => {
        // only the generator's own blocks open one, and an empty message reads as untranslated
        fc.pre(piece.src.split('{${').length - 1 === piece.blocks && piece.src.trim() !== '');
        fc.pre(!piece.afterVariants);
        for (const count of [1, 5]) {
          const result = render(piece, count);
          if (!result) return;
          if (content(result.shown) === content(piece.show(count))) continue;
          // a difference is allowed only when extract warns about it
          expect(escapedSyntax(result.message), result.message).toBeDefined();
        }
      }),
      { numRuns: 3000, seed: 74 },
    );
  });
});
