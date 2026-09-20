import { describe, expect, it } from 'vitest';
import { triage } from '../src/triage';

const signals = (result: ReturnType<typeof triage>, key: string) =>
  (result[key] ?? []).map((r) => r.signal).sort();

describe('divergent source', () => {
  // The English already broke the agreement, so the machine had no better chance than the humans.
  it('flags a source text that a reviewed locale rendered two ways', () => {
    const result = triage({
      source: { a: 'Get started', b: 'Get started' },
      target: { a: 'Commencer', b: 'Demarrer' },
      reviewed: [{ locale: 'es', catalog: { a: 'Comienza ahora', b: 'Empezar' } }],
    });
    expect(signals(result, 'a')).toEqual(['divergent']);
    expect(signals(result, 'b')).toEqual(['divergent']);
  });

  it('stays quiet when the reviewed locale agreed with itself', () => {
    const result = triage({
      source: { a: 'Close', b: 'Close' },
      target: { a: 'Fermer', b: 'Fermer' },
      reviewed: [{ locale: 'es', catalog: { a: 'Cerrar', b: 'Cerrar' } }],
    });
    expect(result).toEqual({});
  });

  // A locale still being filled is not evidence: its blank is not a second rendering.
  it('does not read a blank in a reviewed locale as a disagreement', () => {
    const result = triage({
      source: { a: 'Close', b: 'Close' },
      target: { a: 'Fermer', b: 'Fermer' },
      reviewed: [
        { locale: 'es', catalog: { a: 'Cerrar', b: '' } },
        { locale: 'pt', catalog: { a: 'Fechar' } },
      ],
    });
    expect(result).toEqual({});
  });

  it('falls back to the result when no reviewed locale can tell', () => {
    const result = triage({
      source: { a: 'Close', b: 'Close' },
      target: { a: 'Fermer', b: 'Quitter' },
      reviewed: [],
    });
    expect(signals(result, 'a')).toEqual(['collision']);
  });
});

describe('echo of the source', () => {
  // Without the cross-check this fires on every do-not-translate token and gets ignored.
  it('flags a copy of the source only when the others did translate it', () => {
    const result = triage({
      source: { a: 'Docs' },
      target: { a: 'Docs' },
      reviewed: [
        { locale: 'es', catalog: { a: 'Documentacion' } },
        { locale: 'pt', catalog: { a: 'Documentacao' } },
      ],
    });
    expect(signals(result, 'a')).toEqual(['echo']);
  });

  it('stays quiet on a token nobody translates', () => {
    const result = triage({
      source: { a: 'JSON' },
      target: { a: 'JSON' },
      reviewed: [
        { locale: 'es', catalog: { a: 'JSON' } },
        { locale: 'pt', catalog: { a: 'JSON' } },
      ],
    });
    expect(result).toEqual({});
  });
});

describe('deterministic gates', () => {
  it('reads a decimal separator as idiomatic and a changed digit as a fault', () => {
    const ok = triage({
      source: { a: '3.09 KB' },
      target: { a: '3,09 KB' },
      reviewed: [],
    });
    expect(ok).toEqual({});

    const bad = triage({
      source: { a: 'Node 20+' },
      target: { a: 'Node 22+' },
      reviewed: [],
    });
    expect(signals(bad, 'a')).toEqual(['digits']);
  });

  it('flags a changed url and a changed code span', () => {
    const result = triage({
      source: { a: 'See https://verbaly.dev/docs', b: 'Run <code>npx verbaly</code>' },
      target: { a: 'Voir https://verbaly.dev/fr', b: 'Lancez <code>npx verbaly-fr</code>' },
      reviewed: [],
    });
    expect(signals(result, 'a')).toEqual(['url']);
    expect(signals(result, 'b')).toEqual(['code']);
  });
});

describe('triage cannot be crashed or muted by its own data', () => {
  // Proved able to fail by building bySource and out as {} instead of Object.create(null).
  it('survives a source text that names a member of Object.prototype', () => {
    const result = triage({
      source: { a: '__proto__', b: '__proto__', c: 'toString' },
      target: { a: 'uno', b: 'dos', c: 'tres' },
      reviewed: [],
    });
    expect(signals(result, 'a')).toEqual(['collision']);
    expect(result['c']).toBeUndefined();
  });

  // Proved able to fail by going back to reviewed.every(): one blank control silenced every key.
  it('lets a half-filled control vote on the keys it did fill', () => {
    const result = triage({
      source: { a: 'Docs' },
      target: { a: 'Docs' },
      reviewed: [
        { locale: 'es', catalog: { a: 'Documentacion' } },
        { locale: 'pt', catalog: { b: 'Otra' } },
      ],
    });
    expect(signals(result, 'a')).toEqual(['echo']);
  });
});

describe('the two measured false positives, each pinned by the case that produced it', () => {
  // Every digits hit on this project's own site was one of these two, 10 of 10, all correct text.
  it('ignores the punctuation that follows a number', () => {
    const result = triage({
      source: { a: 'with BCP-47 narrowing, and more' },
      target: { a: 'con narrowing BCP-47, y mas' },
      reviewed: [],
    });
    expect(result).toEqual({});
  });

  it('ignores a number the translation added where the source had none', () => {
    const idiomatic = triage({
      source: { a: 'survives a refresh' },
      target: { a: 'sobrevive al F5' },
      reviewed: [],
    });
    expect(idiomatic).toEqual({});

    const changed = triage({ source: { a: 'Node 20+' }, target: { a: 'Node 22+' }, reviewed: [] });
    expect(signals(changed, 'a')).toEqual(['digits']);
  });
});

// a label like "a link changed" fits the column and says nothing: a reason names its evidence
describe('a reason names its evidence', () => {
  const why = (result: ReturnType<typeof triage>, key: string) =>
    (result[key] ?? []).map((r) => r.text);

  it('divergent names the language and both renderings it already used', () => {
    const result = triage({
      source: { a: 'Get started', b: 'Get started' },
      target: { a: 'Commencer', b: 'Demarrer' },
      reviewed: [{ locale: 'es', catalog: { a: 'Comienza ahora', b: 'Empezar' } }],
    });
    expect(why(result, 'a')[0]).toBe(
      'es already says this two ways: "Comienza ahora" and "Empezar"',
    );
  });

  it('collision names the sibling key and what it says there', () => {
    const result = triage({
      source: { a: 'Get started', b: 'Get started' },
      target: { a: 'Commencer', b: 'Demarrer' },
      reviewed: [],
    });
    expect(why(result, 'a')[0]).toBe('b has the same source text and says "Demarrer"');
  });

  it('echo names the locales that did translate it', () => {
    const result = triage({
      source: { a: 'Docs' },
      target: { a: 'Docs' },
      reviewed: [
        { locale: 'es', catalog: { a: 'Documentacion' } },
        { locale: 'pt', catalog: { a: 'Documentacao' } },
      ],
    });
    expect(why(result, 'a')[0]).toBe('still the source text, and es and pt did translate it');
  });

  it('digits quotes the number that moved, on both sides', () => {
    const result = triage({ source: { a: 'Node 20+' }, target: { a: 'Node 22+' }, reviewed: [] });
    expect(why(result, 'a')[0]).toBe('the source says "20", this one says "22"');
  });

  it('digits says which side is missing one when only one side has it', () => {
    const gone = triage({ source: { a: 'Node 20+' }, target: { a: 'Node recent' }, reviewed: [] });
    expect(why(gone, 'a')[0]).toBe('the source says "20" and this one does not');
  });

  it('url quotes the link', () => {
    const result = triage({
      source: { a: 'see https://verbaly.dev/a' },
      target: { a: 'ver https://verbaly.dev/b' },
      reviewed: [],
    });
    expect(why(result, 'a')[0]).toBe(
      'the source links to "https://verbaly.dev/a", this one links to "https://verbaly.dev/b"',
    );
  });

  // a reason is three short lines in the board, so a long message cannot push the column open
  it('clips a long quote instead of letting it run', () => {
    const long = 'Get started with the compiler and the whole write to ship cycle today';
    const result = triage({
      source: { a: long, b: long },
      target: { a: 'Commencer', b: 'Demarrer' },
      reviewed: [{ locale: 'es', catalog: { a: 'Comienza ahora mismo con todo el compilador', b: 'Empezar' } }],
    });
    const text = why(result, 'a')[0]!;
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(100);
  });
});
