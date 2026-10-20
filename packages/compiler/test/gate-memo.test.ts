import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'verbaly';
import { describe, expect, it, vi } from 'vitest';
import type { Catalogs } from '../src/catalog';
import { check } from '../src/check';
import { resolveConfig } from '../src/config';
import { MessageRegistry } from '../src/registry';
import { validateMessage } from '../src/validate';

// the core's parse, counted: past its cap, a rebuild that reads through it parses everything again
vi.mock('verbaly', async (importOriginal) => {
  const core = await importOriginal<typeof import('verbaly')>();
  return { ...core, parse: vi.fn(core.parse) };
});

const cfg = resolveConfig({
  root: mkdtempSync(join(tmpdir(), 'verbaly-gate-memo-')),
  sourceLocale: 'en',
  locales: ['en', 'es'],
});

const parsed = (texts: string[]): string[] =>
  vi
    .mocked(parse)
    .mock.calls.map(([text]) => text)
    .filter((text) => texts.includes(text));

const pass = (catalogs: Catalogs) => check(cfg, catalogs, new MessageRegistry());

describe('the gate between rebuilds', () => {
  it('reads every text of an unchanged catalog from its own memo on the next pass', () => {
    const catalogs = {
      en: { files: '{n | one: # memo file | other: # memo files}', hi: 'Memo hello <b>{name}</b>' },
      es: {
        files: '{n | one: # archivo memo | other: # archivos memo}',
        hi: 'Hola memo <b>{name}</b>',
      },
    };
    pass(catalogs);
    vi.mocked(parse).mockClear();
    pass(catalogs);
    expect(parsed([...Object.values(catalogs.en), ...Object.values(catalogs.es)])).toEqual([]);
  });

  it('drops a text the last pass did not read, so the memo follows the catalogs', () => {
    const alpha = { en: { m: 'Alpha memo {n}' }, es: { m: 'Alfa memo {n}' } };
    const beta = { en: { m: 'Beta memo {n}' }, es: { m: 'Beta memo es {n}' } };
    pass(alpha);
    pass(beta);
    vi.mocked(parse).mockClear();
    pass(alpha);
    expect(new Set(parsed(['Alpha memo {n}', 'Alfa memo {n}']))).toEqual(
      new Set(['Alpha memo {n}', 'Alfa memo {n}']),
    );
  });

  it('parses each text once in a pass, however many of its checks read it', () => {
    const catalogs = {
      en: { c: 'Once memo {n} <i>x</i>' },
      es: { c: 'Una vez memo {n} <i>x</i>' },
    };
    vi.mocked(parse).mockClear();
    pass(catalogs);
    expect(parsed([catalogs.en.c, catalogs.es.c]).sort()).toEqual(
      [catalogs.es.c, catalogs.en.c].sort(),
    );
  });

  // the MCP server and Studio validate every save: outside check() nothing may pile up
  it('keeps nothing from a validation outside a gate pass', () => {
    const text = 'Outside the gate memo {n}';
    vi.mocked(parse).mockClear();
    validateMessage(text, 'en');
    validateMessage(text, 'en');
    expect(parsed([text])).toEqual([text, text]);
  });

  it('gives the same verdict on the pass that reads from the memo', () => {
    const broken = { en: { k: 'Memo {count} left' }, es: { k: 'Quedan memo' } };
    const first = pass(broken);
    const second = pass(broken);
    expect(second.broken).toEqual(first.broken);
    expect(second.broken.map((entry) => entry.issue)).toEqual([
      '{count} is missing, so its value never reaches the text',
    ]);
  });
});
