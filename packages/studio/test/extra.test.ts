import { describe, expect, it } from 'vitest';
import { toPanel } from '../src/ui/model';

function raw(extra?: { locale: string; key: string; files: string[] }[]) {
  return {
    root: '/app',
    dir: '/app/locales',
    sourceLocale: 'en',
    locales: ['en', 'es'],
    scanning: true,
    catalogs: { en: { hi: 'Hi' }, es: { hi: 'Hola', stray: 'Sobra' } },
    origins: {},
    drafts: {},
    triage: {},
    check: { broken: [], ...(extra ? { extra } : {}) },
    problems: [],
  };
}

describe('a key only a translation has', () => {
  // Proved able to fail by dropping raw.check.extra from toPanel: the list comes back empty.
  it('reaches the panel with its language, since the rows only come from the source', () => {
    const panel = toPanel(raw([{ locale: 'es', key: 'stray', files: [] }]));
    expect(panel.extra).toEqual([{ locale: 'es', key: 'stray', files: [] }]);
    expect(panel.rows.map((row) => row.key)).toEqual(['hi']);
  });

  // an older server does not send the field, and a panel that crashed on that would be worse
  it('is an empty list when the server does not report it', () => {
    expect(toPanel(raw()).extra).toEqual([]);
  });
});
