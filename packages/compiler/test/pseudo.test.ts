import { describe, expect, it } from 'vitest';
import { pseudoCatalogs, pseudoLocalize } from '../src/pseudo';
import { structureMatches } from '../src/translate';
import { resolveConfig } from '../src/config';

describe('pseudoLocalize', () => {
  it('accents letters and wraps with markers + padding', () => {
    const out = pseudoLocalize('Hello world');
    expect(out.startsWith('⟦')).toBe(true);
    expect(out.endsWith('⟧')).toBe(true);
    expect(out).toContain('Ĥéĺĺó ŵóŕĺđ');
    expect(out).toMatch(/~+⟧$/);
  });

  it('keeps params verbatim', () => {
    const out = pseudoLocalize('Hello {name}, {count:integer} files');
    expect(out).toContain('{name}');
    expect(out).toContain('{count:integer}');
    expect(out).not.toContain('ñáɱé');
  });

  it('keeps whole variant blocks verbatim', () => {
    const msg = '{count | one: # file | other: # files}';
    const out = pseudoLocalize(msg);
    expect(out).toContain(msg);
  });

  it('keeps tags verbatim but accents their inner text', () => {
    const out = pseudoLocalize('The <em>gate</em> holds');
    expect(out).toContain('<em>');
    expect(out).toContain('</em>');
    expect(out).toContain('ğáţé');
  });

  it('keeps escape sequences, accenting only their display text', () => {
    const out = pseudoLocalize('brace {{x}} pipe || hash ##');
    expect(out).toContain('{{ẋ}}'); // escaped braces stay; x is display text
    expect(out).toContain('||');
    expect(out).toContain('##');
  });

  it('copies unbalanced braces verbatim without hanging', () => {
    const out = pseudoLocalize('broken {name');
    expect(out).toContain('{name');
  });

  it('survives structural validation for complex messages', () => {
    const msg =
      'Hi {name}, <strong>{count | one: # file | other: # files}</strong> at {when:date/short}';
    expect(structureMatches(msg, pseudoLocalize(msg))).toBe(true);
  });
});

describe('pseudoCatalogs', () => {
  it('fills every source key and reports generated ones', () => {
    const cfg = resolveConfig({ root: '/tmp/x', sourceLocale: 'en' });
    const catalogs = {
      en: { a: 'Hello', b: 'Bye {name}', c: '' },
    };
    const keys = pseudoCatalogs(cfg, catalogs);
    expect(keys.sort()).toEqual(['a', 'b']);
    const pseudo = catalogs['en-XA' as keyof typeof catalogs]!;
    expect(pseudo['a']).toContain('Ĥéĺĺó');
    expect(pseudo['b']).toContain('{name}');
    expect(pseudo['c']).toBe('');
  });

  it('honors a custom pseudo locale id', () => {
    const cfg = resolveConfig({ root: '/tmp/x', sourceLocale: 'en' });
    const catalogs: Record<string, Record<string, string>> = { en: { a: 'Hi' } };
    pseudoCatalogs(cfg, catalogs, 'qps-ploc');
    expect(catalogs['qps-ploc']!['a']).toBeDefined();
  });
});
