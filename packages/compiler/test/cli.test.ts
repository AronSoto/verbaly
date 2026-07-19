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

describe('runCli: status', () => {
  it('prints per-locale coverage and never fails the process', async () => {
    const root = makeProject({
      en: { a: 'A', b: 'B' },
      es: { a: 'La A', b: '' },
      pt: { a: 'Um A', b: 'Um B' },
    });
    await runCli(['status', '--root', root]);
    expect(process.exitCode).toBeUndefined();
    const text = output(log);
    expect(text).toContain('2 messages · source: en');
    expect(text).toContain('es: 1/2 translated (50%)');
    expect(text).toContain('pt: 2/2 translated (100%) ✓');
  });

  it('prints machine-readable coverage with --json', async () => {
    const root = makeProject({ en: { a: 'A' }, es: { a: '' } });
    await runCli(['status', '--root', root, '--json']);
    const parsed = JSON.parse(output(log)) as {
      messages: number;
      source: string;
      locales: { locale: string; translated: number; total: number }[];
    };
    expect(parsed).toEqual({
      messages: 1,
      source: 'en',
      locales: [{ locale: 'es', translated: 0, total: 1 }],
    });
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runCli: extract dts option', () => {
  it('dts: false skips the type file, a path redirects it', async () => {
    const root = makeProject({ en: {} }, 'export const x = t`Hi there`;\n');
    writeFileSync(join(root, 'verbaly.config.json'), JSON.stringify({ dts: false }));
    await runCli(['extract', '--root', root]);
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);

    writeFileSync(join(root, 'verbaly.config.json'), JSON.stringify({ dts: '.types/verbaly.d.ts' }));
    await runCli(['extract', '--root', root]);
    expect(existsSync(join(root, '.types', 'verbaly.d.ts'))).toBe(true);
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
  });
});

describe('runCli: wrap', () => {
  it('reports without writing by default and rewrites with --write', async () => {
    const root = makeProject({ en: {} });
    mkdirSync(join(root, 'src'), { recursive: true });
    const file = join(root, 'src', 'App.tsx');
    writeFileSync(file, 'export const x = <h1>Welcome back</h1>;\n');

    await runCli(['wrap', '--root', root]);
    expect(output(log)).toContain('would wrap 1 texts in 1 files');
    expect(output(log)).toContain('src/App.tsx:1  "Welcome back"');
    expect(readFileSync(file, 'utf8')).toContain('<h1>Welcome back</h1>');
    expect(process.exitCode).toBeUndefined();

    await runCli(['wrap', '--root', root, '--write']);
    expect(readFileSync(file, 'utf8')).toContain('{t`Welcome back`}');
    expect(output(log)).toContain('const t = useT()');
  });

  it('says so when there is nothing to wrap', async () => {
    const root = makeProject({ en: {} }, 'export const x = 1;\n');
    await runCli(['wrap', '--root', root]);
    expect(output(log)).toContain('nothing to wrap');
  });

  it('rejects --write on other commands as a stray flag', async () => {
    const root = makeProject({ en: {} });
    await runCli(['status', '--root', root, '--write']);
    expect(output(error)).toContain('--write is not a "status" flag');
    expect(process.exitCode).toBe(1);
  });
});

describe('runCli: extract --watch guardrails', () => {
  it('rejects --watch with --prune', async () => {
    const root = makeProject({ en: { a: 'A' } }, '');
    await runCli(['extract', '--root', root, '--watch', '--prune']);
    expect(output(error)).toContain('--watch runs alone');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --watch with --dry-run', async () => {
    const root = makeProject({ en: { a: 'A' } }, '');
    await runCli(['extract', '--root', root, '--watch', '--dry-run']);
    expect(output(error)).toContain('--watch runs alone');
    expect(process.exitCode).toBe(1);
  });

  it('rejects --watch on other commands', async () => {
    const root = makeProject({ en: { a: 'A' } });
    await runCli(['check', '--root', root, '--watch']);
    expect(output(error)).toContain('--watch is not a "check" flag');
    expect(process.exitCode).toBe(1);
  });
});

describe('runCli: stray flags fail loudly', () => {
  it('rejects --locale on translate with a --locales hint (never silently ignored)', async () => {
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

  it('emits github annotations with source file and line via --reporter', async () => {
    const root = makeProject(
      { en: {}, es: {} },
      "const pad = 1;\nexport const x = t`Hello there`;\nexport const y = t('ghost');\n",
    );
    await runCli(['extract', '--root', root]);
    process.exitCode = undefined;
    await runCli(['check', '--root', root, '--reporter', 'github']);
    const text = output(error);
    expect(text).toContain('::error file=src/app.ts,line=2::missing [es]');
    expect(text).toContain('Hello there');
    expect(text).toContain('::error file=src/app.ts::unknown key "ghost"');
    expect(text).toContain('check failed: 1 missing, 1 unknown');
    expect(process.exitCode).toBe(1);
  });

  it('rejects an unknown reporter', async () => {
    const root = makeProject({ en: {} });
    await runCli(['check', '--root', root, '--reporter', 'junit']);
    expect(output(error)).toContain('unknown reporter "junit"');
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
