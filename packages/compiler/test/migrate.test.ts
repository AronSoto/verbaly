import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig, type ResolvedConfig } from '../src/config';
import { migrateCatalogs } from '../src/migrate';

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
