import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/run';

function makeProject(catalogs: Record<string, Record<string, string>>, source?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-cli-'));
  mkdirSync(join(root, 'locales'));
  for (const [locale, catalog] of Object.entries(catalogs)) {
    writeFileSync(join(root, 'locales', `${locale}.json`), JSON.stringify(catalog, null, 2));
  }
  if (source !== undefined) {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), source);
  }
  return root;
}

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.exitCode = undefined;
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  error.mockRestore();
  warn.mockRestore();
  process.exitCode = undefined;
});

const output = (spy: { mock: { calls: unknown[][] } }): string =>
  spy.mock.calls.map((call) => call.join(' ')).join('\n');

describe('runCli: dispatch and exit codes', () => {
  it('prints help and exits 1 without a command', async () => {
    await runCli([]);
    expect(output(log)).toContain('verbaly · i18n compiler');
    expect(process.exitCode).toBe(1);
  });

  it('prints help and exits 0 with --help', async () => {
    await runCli(['extract', '--help']);
    expect(output(log)).toContain('Usage:');
    expect(process.exitCode).toBe(0);
  });

  it('reports an unknown command and exits 1', async () => {
    await runCli(['frobnicate']);
    expect(output(error)).toContain('unknown command "frobnicate"');
    expect(process.exitCode).toBe(1);
  });

  it('import without files exits 1 with a usage hint', async () => {
    const root = makeProject({ en: { a: 'A' } });
    await runCli(['import', '--root', root]);
    expect(output(error)).toContain('import needs at least one file');
    expect(process.exitCode).toBe(1);
  });

  it('export rejects an unknown format', async () => {
    const root = makeProject({ en: { a: 'A' }, es: { a: '' } });
    await runCli(['export', '--root', root, '--format', 'yaml']);
    expect(output(error)).toContain('unknown format "yaml"');
    expect(process.exitCode).toBe(1);
  });

  it('export rejects --missing for mobile formats', async () => {
    const root = makeProject({ en: { a: 'A' }, es: { a: '' } });
    await runCli(['export', '--root', root, '--format', 'android-xml', '--missing']);
    expect(output(error)).toContain('--missing is for translator formats');
    expect(process.exitCode).toBe(1);
  });

  it('export android-xml writes drop-in resource dirs', async () => {
    const root = makeProject({ en: { a: 'A' }, es: { a: 'La A' } });
    await runCli(['export', '--root', root, '--format', 'android-xml']);
    expect(process.exitCode).toBeUndefined();
    expect(existsSync(join(root, 'verbaly-export', 'values', 'strings.xml'))).toBe(true);
    expect(existsSync(join(root, 'verbaly-export', 'values-es', 'strings.xml'))).toBe(true);
    expect(output(log)).toContain('untranslated skipped');
  });
});

describe('runCli: stray flags fail loudly', () => {
  it("rejects --locale on translate with a --locales hint (never silently ignored)", async () => {
    const root = makeProject({ en: { a: 'A' }, es: { a: '' } });
    await runCli(['translate', '--root', root, '--locale', 'es']);
    expect(output(error)).toContain('--locale is not a "translate" flag (did you mean --locales?)');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --overwrite on extract', async () => {
    const root = makeProject({ en: { a: 'A' } }, '');
    await runCli(['extract', '--root', root, '--overwrite']);
    expect(output(error)).toContain('--overwrite is not a "extract" flag');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --prune outside extract', async () => {
    const root = makeProject({ en: { a: 'A' } });
    await runCli(['check', '--root', root, '--prune']);
    expect(output(error)).toContain('--prune is not a "check" flag');
    expect(process.exitCode).toBe(1);
  });
});

describe('runCli: extract', () => {
  it('extracts messages into every catalog and writes types', async () => {
    const root = makeProject({ en: {}, es: {} }, 'export const x = t`Hello there`;\n');
    await runCli(['extract', '--root', root]);
    expect(process.exitCode).toBeUndefined();
    const en = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(Object.values(en)).toContain('Hello there');
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(Object.values(es)).toContain('');
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(true);
  });

  it('--prune --dry-run reports removals but writes nothing', async () => {
    const root = makeProject(
      { en: { orphan: 'Old' }, es: { orphan: 'Viejo' } },
      'export const x = t`Hello there`;\n',
    );
    const before = readFileSync(join(root, 'locales', 'en.json'), 'utf8');
    await runCli(['extract', '--root', root, '--prune', '--dry-run']);
    expect(output(log)).toContain('would prune');
    expect(output(log)).toContain('dry run, nothing written');
    expect(readFileSync(join(root, 'locales', 'en.json'), 'utf8')).toBe(before);
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
  });

  it('--prune drops keys no longer referenced', async () => {
    const root = makeProject(
      { en: { orphan: 'Old' }, es: { orphan: 'Viejo' } },
      'export const x = t`Hello there`;\n',
    );
    await runCli(['extract', '--root', root, '--prune']);
    const en = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(en).not.toHaveProperty('orphan');
    expect(Object.values(en)).toContain('Hello there');
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(es).not.toHaveProperty('orphan');
  });
});

describe('runCli: check', () => {
  it('exits 1 on missing translations', async () => {
    const root = makeProject({ en: {}, es: {} }, 'export const x = t`Hello there`;\n');
    await runCli(['extract', '--root', root]);
    await runCli(['check', '--root', root]);
    expect(output(error)).toContain('check failed');
    expect(process.exitCode).toBe(1);
  });

  it('passes when every locale is complete', async () => {
    const root = makeProject({ en: {}, es: {} }, 'export const x = t`Hello there`;\n');
    await runCli(['extract', '--root', root]);
    const esPath = join(root, 'locales', 'es.json');
    const es = JSON.parse(readFileSync(esPath, 'utf8')) as Record<string, string>;
    for (const key of Object.keys(es)) es[key] = 'Hola';
    writeFileSync(esPath, JSON.stringify(es, null, 2));
    process.exitCode = undefined;
    await runCli(['check', '--root', root]);
    expect(output(log)).toContain('all translations complete');
    expect(process.exitCode).toBeUndefined();
  });
});
