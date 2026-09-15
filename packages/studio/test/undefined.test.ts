import { describe, expect, it } from 'vitest';
import { toPanel } from '../src/ui/model';

function raw(unknown?: { key: string; files: string[] }[]) {
  return {
    root: '/app',
    dir: '/app/locales',
    sourceLocale: 'en',
    locales: ['en', 'es'],
    scanning: true,
    catalogs: { en: { hi: 'Hi' }, es: { hi: 'Hola' } },
    origins: {},
    drafts: {},
    triage: {},
    check: { broken: [], ...(unknown ? { unknown } : {}) },
    problems: [],
  };
}

describe('a key the code calls that no catalog defines', () => {
  // Proved able to fail by dropping raw.check.unknown from toPanel: the list comes back empty.
  it('reaches the panel, because it fails the build and has no row to live in', () => {
    const panel = toPanel(raw([{ key: 'cta.buy', files: ['src/Cart.tsx'] }]));
    expect(panel.undefined).toEqual([{ key: 'cta.buy', files: ['src/Cart.tsx'] }]);
  });

  it('is never a row, since there is no message to show and no language to show it in', () => {
    const panel = toPanel(raw([{ key: 'cta.buy', files: ['src/Cart.tsx'] }]));
    expect(panel.rows.map((row) => row.key)).toEqual(['hi']);
  });

  // an older server does not send the field, and a panel that crashed on that would be worse
  it('is an empty list when the server does not report it', () => {
    expect(toPanel(raw()).undefined).toEqual([]);
  });
});
