import { describe, expect, it } from 'vitest';
import { isLocaleTag, projectLocale, suggestTag } from '../src/tag';

describe('a locale is a tag Intl can read', () => {
  it('accepts what Intl accepts, scripts, regions and extensions included', () => {
    const valid = ['en', 'pt-BR', 'PT-br', 'zh-Hant-TW', 'es-419', 'en-XA', 'en-US-u-nu-arab'];
    for (const tag of valid) expect(isLocaleTag(tag), tag).toBe(true);
  });

  it('refuses what makes Intl throw at runtime', () => {
    for (const tag of ['', 'pt_BR', 'x', 'pt-', 'constructor']) {
      expect(isLocaleTag(tag), tag).toBe(false);
    }
  });

  it('suggests the hyphen only when that is the whole fix', () => {
    expect(suggestTag('pt_BR')).toBe('pt-BR');
    expect(suggestTag('zh_Hant_TW')).toBe('zh-Hant-TW');
    expect(suggestTag('x')).toBeUndefined();
    expect(suggestTag('pt-BR')).toBeUndefined();
  });
});

describe('the project spelling of a tag written another way', () => {
  it('matches underscores and case against the locales the project has', () => {
    const locales = ['en', 'pt-BR', 'es'];
    expect(projectLocale('pt-BR', locales)).toBe('pt-BR');
    expect(projectLocale('pt_BR', locales)).toBe('pt-BR');
    expect(projectLocale('PT-br', locales)).toBe('pt-BR');
  });

  // a language is not its region: pt is a different locale, so it is not quietly folded into pt-BR
  it('never folds a different locale into one that shares its language', () => {
    expect(projectLocale('pt', ['en', 'pt-BR'])).toBeUndefined();
    expect(projectLocale('fr', ['en', 'pt-BR'])).toBeUndefined();
  });
});
