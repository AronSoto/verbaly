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
      reviewed: [{ a: 'Comienza ahora', b: 'Empezar' }],
    });
    expect(signals(result, 'a')).toEqual(['divergent']);
    expect(signals(result, 'b')).toEqual(['divergent']);
  });

  it('stays quiet when the reviewed locale agreed with itself', () => {
    const result = triage({
      source: { a: 'Close', b: 'Close' },
      target: { a: 'Fermer', b: 'Fermer' },
      reviewed: [{ a: 'Cerrar', b: 'Cerrar' }],
    });
    expect(result).toEqual({});
  });

  // A locale still being filled is not evidence: its blank is not a second rendering.
  it('does not read a blank in a reviewed locale as a disagreement', () => {
    const result = triage({
      source: { a: 'Close', b: 'Close' },
      target: { a: 'Fermer', b: 'Fermer' },
      reviewed: [{ a: 'Cerrar', b: '' }, { a: 'Fechar' }],
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
      reviewed: [{ a: 'Documentacion' }, { a: 'Documentacao' }],
    });
    expect(signals(result, 'a')).toEqual(['echo']);
  });

  it('stays quiet on a token nobody translates', () => {
    const result = triage({
      source: { a: 'JSON' },
      target: { a: 'JSON' },
      reviewed: [{ a: 'JSON' }, { a: 'JSON' }],
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
      reviewed: [{ a: 'Documentacion' }, { b: 'Otra' }],
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
