import { describe, expect, it } from 'vitest';
import { emptyReason, toPanel, visible } from '../src/ui/model';
import { EMPTY } from '../src/ui/words';

// An empty screen that names what to click instead of what is true is the worst first run.
function raw(over: Partial<Parameters<typeof toPanel>[0]> = {}) {
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
    check: { broken: [] },
    problems: [],
    ...over,
  };
}

function reason(state: ReturnType<typeof raw>, ticked?: string[], text = '') {
  const panel = toPanel(state);
  const targets = panel.locales.filter((locale) => locale !== panel.sourceLocale);
  const shown = ticked ?? targets.slice(0, 1);
  return emptyReason(panel, shown, visible(panel.rows, { text, state: 'all', locales: shown }));
}

describe('the empty screen names what is actually true', () => {
  // Proved able to fail by answering pickOne here: a project with one language has nothing to tick.
  it('does not ask you to tick a language when there is none to tick', () => {
    expect(reason(raw({ locales: ['en'], catalogs: { en: { hi: 'Hi' } } }))).toBe('oneLocale');
  });

  // Proved able to fail by asking about locales before rows: with no catalogs both are empty.
  it('says the catalogs are empty before it says anything about languages', () => {
    expect(reason(raw({ locales: ['en'], catalogs: { en: {} } }))).toBe('noCatalogs');
  });

  it('asks you to tick one only when there is one to tick', () => {
    expect(reason(raw(), [])).toBe('pickOne');
  });

  it('blames the filter when the filter is what emptied the list', () => {
    expect(reason(raw(), undefined, 'nothing like this exists')).toBe('noMatch');
  });

  it('gets out of the way when there are rows to show', () => {
    expect(reason(raw())).toBeNull();
  });

  // Proved able to fail by dropping a branch from Panel.svelte: the words would have no reader.
  it('is read by Panel.svelte, so none of these is written and never shown', () => {
    expect(Object.keys(EMPTY).sort()).toEqual(
      ['noCatalogs', 'noMatch', 'oneLocale', 'oneLocaleFix', 'pickOne'].sort(),
    );
  });

  // every one of them has to name a fact, and a period is what separates a fact from a label
  it('is written as sentences, because this is the one screen with room for them', () => {
    for (const text of Object.values(EMPTY)) expect(text).toMatch(/\.$/);
  });
});
