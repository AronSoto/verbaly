import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { MessageRegistry } from '../src/registry';
import { formatStatusResult, status } from '../src/status';

function cfg(locales: string[] = ['en', 'es']) {
  return resolveConfig({
    root: mkdtempSync(join(tmpdir(), 'verbaly-status-')),
    sourceLocale: 'en',
    locales,
  });
}

describe('status', () => {
  it('counts per-locale coverage against source keys', () => {
    const result = status(
      cfg(['en', 'es']),
      { en: { a: 'A', b: 'B' }, es: { a: 'La A', b: '' } },
      new MessageRegistry(),
    );
    expect(result).toEqual({
      messages: 2,
      source: 'en',
      locales: [{ locale: 'es', translated: 1, total: 2, drafts: 0, broken: 0 }],
    });
  });

  it('counts a nested catalog by its leaves', () => {
    // by top-level groups this read 1/1 (100%) with half the site untranslated
    const result = status(
      cfg(['en', 'es']),
      {
        en: { nav: { home: 'Home', docs: 'Docs' } },
        es: { nav: { home: 'Inicio', docs: '' } },
      } as never,
      new MessageRegistry(),
    );
    expect(result.messages).toBe(2);
    expect(result.locales[0]).toEqual({
      locale: 'es',
      translated: 1,
      total: 2,
      drafts: 0,
      broken: 0,
    });
  });

  it('tolerates a missing source catalog (nothing needed, all locales complete)', () => {
    const result = status(cfg(['en', 'es']), {}, new MessageRegistry());
    expect(result.messages).toBe(0);
    expect(result.locales).toEqual([
      { locale: 'es', translated: 0, total: 0, drafts: 0, broken: 0 },
    ]);
  });

  it('counts live drafts per locale and ignores drafts whose value is gone', () => {
    const result = status(
      cfg(['en', 'es']),
      { en: { a: 'A', b: 'B' }, es: { a: 'La A', b: '' } },
      new MessageRegistry(),
      { es: ['a', 'b'] }, // 'b' is empty in es: no longer a live draft
    );
    expect(result.locales[0]!.drafts).toBe(1);
  });

  it('counts translations that are present but cannot render the source', () => {
    const result = status(
      cfg(['en', 'es']),
      { en: { a: 'Hello {name}', b: 'Plain' }, es: { a: 'Hola', b: 'Simple' } },
      new MessageRegistry(),
    );
    expect(result.locales[0]!.translated).toBe(2);
    expect(result.locales[0]!.broken).toBe(1);
  });

  it('counts broken leaves in a nested catalog', () => {
    const result = status(
      cfg(['en', 'es']),
      {
        en: { hero: { title: 'Hello {name}', lead: 'Plain' } },
        es: { hero: { title: 'Hola', lead: 'Simple' } },
      } as unknown as Parameters<typeof status>[1],
      new MessageRegistry(),
    );
    expect(result.locales[0]!.broken).toBe(1);
  });

  it('does not count a locale-incomplete plural as broken (it renders)', () => {
    const result = status(
      cfg(['en', 'pl']),
      {
        en: { a: '{count | one: one item | other: # items}' },
        pl: { a: '{count | one: 1 element | other: # elementow}' },
      },
      new MessageRegistry(),
    );
    expect(result.locales[0]!.broken).toBe(0);
  });
});

describe('formatStatusResult', () => {
  it('shows a percentage and a check mark at full coverage', () => {
    const text = formatStatusResult({
      messages: 2,
      source: 'en',
      locales: [
        { locale: 'es', translated: 1, total: 2, drafts: 0, broken: 0 },
        { locale: 'pt', translated: 2, total: 2, drafts: 0, broken: 0 },
      ],
    });
    expect(text).toContain('es: 1/2 translated (50%)');
    expect(text).toContain('pt: 2/2 translated (100%) ✓');
  });

  it('reports 100% for an empty catalog (no division by zero)', () => {
    const text = formatStatusResult({
      messages: 0,
      source: 'en',
      locales: [{ locale: 'es', translated: 0, total: 0, drafts: 0, broken: 0 }],
    });
    expect(text).toContain('es: 0/0 translated (100%) ✓');
  });

  it('notes unreviewed machine drafts inline', () => {
    const text = formatStatusResult({
      messages: 2,
      source: 'en',
      locales: [{ locale: 'es', translated: 2, total: 2, drafts: 1, broken: 0 }],
    });
    expect(text).toContain('es: 2/2 translated (100%, 1 unreviewed) ✓');
  });

  it('notes broken translations and drops the check mark', () => {
    const text = formatStatusResult({
      messages: 2,
      source: 'en',
      locales: [{ locale: 'es', translated: 2, total: 2, drafts: 1, broken: 2 }],
    });
    expect(text).toContain('es: 2/2 translated (100%, 1 unreviewed, 2 broken)');
    expect(text).not.toContain('✓');
  });

  it('says so when there are no target locales', () => {
    const text = formatStatusResult({ messages: 0, source: 'en', locales: [] });
    expect(text).toContain('no target locales');
  });
});
