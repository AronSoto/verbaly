import { describe, expect, it } from 'vitest';
import { health, toPanel, visible, type Panel } from '../src/ui/model';

function raw(over: Partial<Parameters<typeof toPanel>[0]> = {}) {
  return {
    root: '/app',
    dir: '/app/locales',
    sourceLocale: 'en',
    locales: ['en', 'es', 'pt'],
    catalogs: {
      en: { nav: { home: 'Home' }, greet: 'Hi {name}', bye: 'Bye', gone: 'Gone' },
      es: { nav: { home: 'Inicio' }, greet: 'Hola', bye: '', gone: 'Ido' },
      pt: { nav: { home: 'Inicio' }, greet: 'Ola {name}', bye: 'Tchau', gone: '' },
    },
    origins: { 'nav.home': ['src/Nav.tsx'] },
    drafts: { pt: ['bye', 'gone'] },
    triage: { es: { 'nav.home': [{ signal: 'echo', text: 'still identical to the source' }] } },
    check: {
      broken: [{ locale: 'es', key: 'greet', severity: 'error', issue: '{name} is missing' }],
    },
    problems: [],
    ...over,
  };
}

describe('the state of a cell, which is what the whole screen is coloured by', () => {
  const panel = toPanel(raw());
  const row = (key: string) => panel.rows.find((r) => r.key === key)!;
  const cell = (key: string, locale: string) => row(key).cells.find((c) => c.locale === locale)!;

  it('reads a nested catalog without asking anyone to flatten it', () => {
    expect(row('nav.home').source).toBe('Home');
    expect(cell('nav.home', 'es').text).toBe('Inicio');
  });

  it('never makes a row for the source language', () => {
    expect(panel.rows.every((r) => r.cells.every((c) => c.locale !== 'en'))).toBe(true);
    expect(panel.rows[0]!.cells.map((c) => c.locale)).toEqual(['es', 'pt']);
  });

  // Proved able to fail by dropping the broken branch: it reads as done, which is the worst answer.
  it('calls a translation broken before it calls it done', () => {
    expect(cell('greet', 'es').state).toBe('broken');
    expect(cell('greet', 'es').issue).toContain('{name}');
  });

  it('calls an empty string missing, which is what it means everywhere else', () => {
    expect(cell('bye', 'es').state).toBe('missing');
  });

  // Proved able to fail by checking drafts first; effectiveDrafts only guards the server path.
  it('calls a machine translation a draft only when there is text', () => {
    expect(cell('bye', 'pt').state).toBe('draft');
    expect(cell('nav.home', 'pt').state).toBe('done');
    expect(cell('gone', 'pt').state).toBe('missing');
  });

  // Proved able to fail by storing health: a saved cell left the rail on its old count.
  it('counts each language on its own, and the source is never counted as work', () => {
    const rail = health(panel);
    const of = (locale: string) => rail.find((h) => h.locale === locale)!;
    expect(of('en').source).toBe(true);
    expect(of('es')).toMatchObject({ done: 2, broken: 1, missing: 1, draft: 0 });
    expect(of('pt')).toMatchObject({ done: 2, draft: 1, missing: 1, broken: 0 });
  });

  // Proved able to fail by dropping the signals: the row worth reading looks like the rest.
  it('carries the triage signal to the language it was measured on', () => {
    expect(cell('nav.home', 'es').signals).toEqual(['echo']);
    expect(cell('nav.home', 'pt').signals).toEqual([]);
  });

  it('only treats an error as broken, because a warning is not a failure', () => {
    const warned = toPanel(
      raw({
        check: {
          broken: [{ locale: 'es', key: 'greet', severity: 'warning', issue: 'ru needs few' }],
        },
      }),
    );
    expect(warned.rows.find((r) => r.key === 'greet')!.cells[0]!.state).toBe('done');
  });
});

describe('what the table shows, which is the search and the filters together', () => {
  const panel: Panel = toPanel(raw());
  const all = { text: '', state: 'all' as const, locales: ['es', 'pt'] };

  it('searches the source and every shown translation, never the key', () => {
    expect(visible(panel.rows, { ...all, text: 'Inicio' }).map((r) => r.key)).toEqual(['nav.home']);
    expect(visible(panel.rows, { ...all, text: 'Home' }).map((r) => r.key)).toEqual(['nav.home']);
    expect(visible(panel.rows, { ...all, text: 'nav.home' })).toEqual([]);
  });

  // Proved able to fail by filtering over every cell: a row hides its language and still shows up.
  it('answers only about the languages you ticked', () => {
    expect(visible(panel.rows, { ...all, state: 'broken' }).map((r) => r.key)).toEqual(['greet']);
    expect(visible(panel.rows, { text: '', state: 'broken', locales: ['pt'] })).toEqual([]);
    expect(visible(panel.rows, { text: 'Tchau', state: 'all', locales: ['es'] })).toEqual([]);
  });

  it('takes the search and the filter at the same time', () => {
    expect(visible(panel.rows, { text: 'Bye', state: 'missing', locales: ['es'] })).toHaveLength(1);
    expect(visible(panel.rows, { text: 'Bye', state: 'missing', locales: ['pt'] })).toHaveLength(0);
  });

  // Proved able to fail by treating 'look' as a state: it would ask for one nobody has.
  it('shows what the triage flagged, whichever state it is in', () => {
    expect(visible(panel.rows, { text: '', state: 'look', locales: ['es'] }).map((r) => r.key)).toEqual([
      'nav.home',
    ]);
    expect(visible(panel.rows, { text: '', state: 'look', locales: ['pt'] })).toEqual([]);
  });

  it('ignores the spaces around what you typed', () => {
    expect(visible(panel.rows, { ...all, text: '   ' })).toHaveLength(4);
    expect(visible(panel.rows, { ...all, text: '  Home  ' })).toHaveLength(1);
  });
});
