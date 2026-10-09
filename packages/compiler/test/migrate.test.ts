import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVerbaly } from 'verbaly';
import { describe, expect, it } from 'vitest';
import { resolveConfig, type ResolvedConfig } from '../src/config';
import { migrateCatalogs } from '../src/migrate';
import { loadState, STATE_FILE, updateState } from '../src/state';

function project(
  catalogs: Record<string, unknown>,
  deps: Record<string, string> = { i18next: '^23.0.0' },
): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-migrate-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'demo', dependencies: deps }));
  for (const [locale, catalog] of Object.entries(catalogs)) {
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog, null, 2));
  }
  return resolveConfig({ root, sourceLocale: 'en', locales: Object.keys(catalogs) });
}

const read = (cfg: ResolvedConfig, locale: string) =>
  JSON.parse(readFileSync(join(cfg.dir, `${locale}.json`), 'utf8'));

describe('the one transformation that is not optional', () => {
  it('turns the doubled braces into single ones and leaves the shape alone', () => {
    const cfg = project({ en: { inbox: { greeting: 'Hello {{name}}' }, plain: 'Nothing' } });
    const result = migrateCatalogs(cfg, { write: true });

    expect(result.braces).toEqual([
      { locale: 'en', key: 'inbox.greeting', before: 'Hello {{name}}', after: 'Hello {name}' },
    ]);
    // the nesting is the reader's, not ours: a migration that reshaped it would be a second job
    expect(read(cfg, 'en')).toEqual({ inbox: { greeting: 'Hello {name}' }, plain: 'Nothing' });
  });

  it('writes nothing until it is asked to', () => {
    const cfg = project({ en: { a: 'Hi {{name}}' } });
    const result = migrateCatalogs(cfg);

    expect(result.braces).toHaveLength(1);
    expect(result.written).toEqual([]);
    expect(read(cfg, 'en')).toEqual({ a: 'Hi {{name}}' });
  });

  it('names the library it found, and says so when it finds none', () => {
    expect(migrateCatalogs(project({ en: {} }, { 'vue-i18n': '^9' })).detected).toEqual(['vue-i18n']);
    expect(migrateCatalogs(project({ en: {} }, {})).detected).toEqual([]);
  });
});

describe('braces i18next shows as text', () => {
  const render = (message: string, params?: Record<string, unknown>) =>
    createVerbaly({ locale: 'en', messages: { en: { m: message } } }).t(
      'm' as never,
      params as never,
    );

  // Proved able to fail by converting {{x}} alone: Memos' text asked for three params it never had.
  it('doubles a lone brace, which Verbaly would read as a param, and keeps the real params', () => {
    const cfg = project({
      en: { tpl: 'Supports {timestamp}. Default: assets/{timestamp}_{name}', hi: 'Hi {{name}}' },
    });
    const result = migrateCatalogs(cfg, { write: true });

    const tpl = 'Supports {{timestamp}}. Default: assets/{{timestamp}}_{{name}}';
    expect(read(cfg, 'en')).toEqual({ tpl, hi: 'Hi {name}' });
    expect(result.braces.map((entry) => entry.key).sort()).toEqual(['hi', 'tpl']);
    expect(render(tpl)).toBe('Supports {timestamp}. Default: assets/{timestamp}_{name}');
    expect(render('Hi {name}', { name: 'Ana' })).toBe('Hi Ana');
  });

  // Proved able to fail without the memory: the second run turned {{timestamp}} back into a param.
  it('remembers what it converted, so a later run never reads an escape as a param', () => {
    const cfg = project({
      en: { tpl: 'Use {id}', hi: 'Hi {{name}}', m_one: 'one {{count}}', m_other: '{{count}} all' },
    });
    migrateCatalogs(cfg, { write: true });
    const again = migrateCatalogs(cfg, { write: true, plurals: true });

    expect(again.remembered).toEqual(['en']);
    expect(again.braces).toEqual([]);
    expect(read(cfg, 'en')).toEqual({
      tpl: 'Use {{id}}',
      hi: 'Hi {name}',
      m: '{count | one: one # | other: # all}',
    });
    const state = JSON.parse(readFileSync(join(cfg.dir, STATE_FILE), 'utf8'));
    expect(state.migrated).toEqual(['en']);
    // extract keeps the sidecar in step with the catalogs, and must carry the memory along
    updateState(cfg, { en: read(cfg, 'en') });
    expect(loadState(cfg).migrated).toEqual(['en']);
  });

  it('converts a language added later, and leaves the ones it converted alone', () => {
    const cfg = project({ en: { tpl: 'Use {id}', hi: 'Hi {{name}}' } });
    migrateCatalogs(cfg, { write: true });
    writeFileSync(
      join(cfg.dir, 'fr.json'),
      JSON.stringify({ tpl: 'Utilise {id}', hi: 'Salut {{name}}' }),
    );
    const later = resolveConfig({ root: cfg.root, sourceLocale: 'en', locales: ['en', 'fr'] });
    const result = migrateCatalogs(later, { write: true });

    expect(result.remembered).toEqual(['en']);
    expect(read(later, 'en')).toEqual({ tpl: 'Use {{id}}', hi: 'Hi {name}' });
    expect(read(later, 'fr')).toEqual({ tpl: 'Utilise {{id}}', hi: 'Salut {name}' });
    expect(loadState(later).migrated).toEqual(['en', 'fr']);
  });

  it('writes no memory for a report, nor for a catalog with no i18next syntax in it', () => {
    const report = project({ en: { hi: 'Hi {{name}}' } });
    migrateCatalogs(report);
    const native = project({ en: { hi: 'Hi {name}' } });
    migrateCatalogs(native, { write: true });

    expect(existsSync(join(report.dir, STATE_FILE))).toBe(false);
    expect(existsSync(join(native.dir, STATE_FILE))).toBe(false);
    expect(read(native, 'en')).toEqual({ hi: 'Hi {name}' });
  });

  it('leaves a {{…}} that holds more than a name to a person', () => {
    const cfg = project({ en: { who: 'By {{user.name}}', hi: 'Hi {{name}}' } });
    const result = migrateCatalogs(cfg, { write: true });

    expect(result.skipped).toContainEqual({
      locale: 'en',
      key: 'who',
      reason: 'uses {{…}} with more than a name, which needs a Verbaly param',
    });
    expect(read(cfg, 'en')).toEqual({ who: 'By {{user.name}}', hi: 'Hi {name}' });
  });

  // Proved able to fail by keeping # and | as they were: the block split, the count printed twice.
  it('doubles the # and | a form carries when it joins a plural block', () => {
    const cfg = project({
      en: { n_one: 'Item #1 | {{count}} thing', n_other: 'Items | {{count}} things' },
    });
    migrateCatalogs(cfg, { write: true, plurals: true });

    const merged = read(cfg, 'en').n;
    expect(merged).toBe('{count | one: Item ##1 || # thing | other: Items || # things}');
    expect(render(merged, { count: 1 })).toBe('Item #1 | 1 thing');
    expect(render(merged, { count: 3 })).toBe('Items | 3 things');
  });
});

describe('what it refuses to guess', () => {
  // Proved able to fail by dropping each guard: the value is rewritten into something that lies.
  it('leaves a format, an unescape and a nesting untouched, each with its reason', () => {
    const cfg = project({
      en: {
        price: 'Total: {{amount, currency}}',
        raw: 'Welcome {{- html}}',
        nested: 'See $t(inbox.title)',
      },
    });
    const result = migrateCatalogs(cfg, { write: true });

    expect(result.braces).toEqual([]);
    expect(result.skipped.map((s) => s.key).sort()).toEqual(['nested', 'price', 'raw']);
    expect(read(cfg, 'en')).toEqual({
      price: 'Total: {{amount, currency}}',
      raw: 'Welcome {{- html}}',
      nested: 'See $t(inbox.title)',
    });
  });
});

describe('the plural merge, which is an upgrade and therefore opt-in', () => {
  it('does nothing to the suffixed keys unless asked', () => {
    const cfg = project({ en: { m_one: 'one message', m_other: '{{count}} messages' } });
    const result = migrateCatalogs(cfg, { write: true });

    expect(result.plurals).toEqual([]);
    expect(read(cfg, 'en')).toEqual({ m_one: 'one message', m_other: '{count} messages' });
  });

  it('merges the suffixes into one message, with the count printing itself', () => {
    const cfg = project({ en: { m_one: 'one message', m_other: '{{count}} messages' } });
    migrateCatalogs(cfg, { write: true, plurals: true });

    expect(read(cfg, 'en')).toEqual({ m: '{count | one: one message | other: # messages}' });
  });

  // i18next before v21 spelled it `key` + `key_plural`, so the bare key is the singular form
  it('reads the bare key as the singular when the catalog is the older spelling', () => {
    const cfg = project({ en: { files: 'one file', files_plural: '{{count}} files' } });
    migrateCatalogs(cfg, { write: true, plurals: true });

    expect(read(cfg, 'en')).toEqual({ files: '{count | one: one file | other: # files}' });
  });

  // Proved able to fail by merging a lone form: English renders "1 things" and nothing warns.
  it('refuses a group that has only a plural form', () => {
    const cfg = project({ en: { things_plural: '{{count}} things' } });
    const result = migrateCatalogs(cfg, { write: true, plurals: true });

    expect(result.plurals).toEqual([]);
    expect(result.skipped).toContainEqual({
      locale: 'en',
      key: 'things',
      reason: 'only a plural form, so add the singular before merging',
    });
    expect(read(cfg, 'en')).toEqual({ things_plural: '{count} things' });
  });

  it('refuses to overwrite a key that already means something else', () => {
    const cfg = project({ en: { taken: 'Already here', taken_one: 'one', taken_other: '{{count}}' } });
    const result = migrateCatalogs(cfg, { write: true, plurals: true });

    expect(result.plurals).toEqual([]);
    expect(result.skipped[0]!.reason).toContain('already exists');
    expect(read(cfg, 'en').taken).toBe('Already here');
  });

  it('carries every locale, and each one keeps its own wording', () => {
    const cfg = project({
      en: { m_one: 'one message', m_other: '{{count}} messages' },
      es: { m_one: 'un mensaje', m_other: '{{count}} mensajes' },
    });
    migrateCatalogs(cfg, { write: true, plurals: true });

    expect(read(cfg, 'en').m).toBe('{count | one: one message | other: # messages}');
    expect(read(cfg, 'es').m).toBe('{count | one: un mensaje | other: # mensajes}');
  });
});

describe('a project with nothing to port', () => {
  it('reports no change and touches no file', () => {
    const cfg = project({ en: { a: 'Hello {name}' } });
    const result = migrateCatalogs(cfg, { write: true, plurals: true });

    expect(result.braces).toEqual([]);
    expect(result.plurals).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.written).toEqual([]);
  });
});
