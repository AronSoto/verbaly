import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDts } from '../src/codegen';
import { stableKey } from '../src/key';
import { runCli } from '../src/run';
import { watchProject } from '../src/watch';

// the CLI never exposes the watcher's dispose, a real one would leak across tests
vi.mock('../src/watch', () => ({ watchProject: vi.fn(() => () => {}) }));

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
      locales: [{ locale: 'es', translated: 0, total: 1, drafts: 0, broken: 0 }],
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

    writeFileSync(
      join(root, 'verbaly.config.json'),
      JSON.stringify({ dts: '.types/verbaly.d.ts' }),
    );
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

  it('lists ambiguous text under "needs a human" without touching it', async () => {
    const root = makeProject({ en: {} });
    mkdirSync(join(root, 'src'), { recursive: true });
    const file = join(root, 'src', 'App.tsx');
    // mixed text and markup at one level: a split sentence ships broken translations
    writeFileSync(file, 'export const x = <p>Hello <strong>there</strong> friend</p>;\n');
    await runCli(['wrap', '--root', root]);
    expect(output(log)).toContain('needs a human:');
    expect(readFileSync(file, 'utf8')).toContain('Hello <strong>there</strong> friend');
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

  it('exits 1 on a hand-edited translation that dropped its param', async () => {
    const key = stableKey('Hello {name}');
    const root = makeProject(
      { en: { [key]: 'Hello {name}' }, es: { [key]: 'Hola' } },
      'export const x = t`Hello ${name}`;\n',
    );
    await runCli(['check', '--root', root]);
    const text = output(error);
    expect(text).toContain('broken translations:');
    expect(text).toContain('{name}');
    expect(process.exitCode).toBe(1);
  });

  it('prints locale plural warnings and still passes', async () => {
    const key = stableKey('{count | one: one item | other: # items}');
    const root = makeProject({
      en: { [key]: '{count | one: one item | other: # items}' },
      pl: { [key]: '{count | one: 1 element | other: # elementow}' },
    });
    await runCli(['check', '--root', root]);
    expect(output(warn)).toContain('the gate still passes');
    expect(output(warn)).toContain('few');
    expect(output(log)).toContain('all translations complete');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a warning as a github warning command, not an error', async () => {
    const key = stableKey('{count | one: one item | other: # items}');
    const root = makeProject({
      en: { [key]: '{count | one: one item | other: # items}' },
      pl: { [key]: '{count | one: 1 element | other: # elementow}' },
    });
    await runCli(['check', '--root', root, '--reporter', 'github']);
    const text = output(error);
    expect(text).toContain('::warning::[pl]');
    expect(text).not.toContain('::error');
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runCli: init', () => {
  it('scaffolds config and catalogs, reports the detected bundler and next steps', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-cli-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { vite: '^8' } }));
    await runCli(['init', '--root', root, '--locales', 'es,pt']);
    expect(process.exitCode).toBeUndefined();
    const text = output(log);
    expect(text).toContain('created:');
    expect(text).toContain('detected bundler: vite');
    expect(text).toContain('next steps:');
    expect(existsSync(join(root, 'locales', 'es.json'))).toBe(true);
  });

  it('keeps existing files on a second run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-cli-'));
    await runCli(['init', '--root', root]);
    log.mockClear();
    await runCli(['init', '--root', root]);
    expect(output(log)).toContain('kept (already there)');
  });
});

describe('runCli: doctor', () => {
  it('reports a healthy setup and exits 0', async () => {
    const key = stableKey('Hi');
    const root = makeProject({ en: { [key]: 'Hi' } }, 'const s = t`Hi`;\n');
    writeFileSync(join(root, 'verbaly.config.json'), '{}');
    writeFileSync(join(root, 'verbaly.d.ts'), generateDts({ [key]: 'Hi' }));
    await runCli(['doctor', '--root', root]);
    expect(output(log)).toContain('setup looks healthy ✓');
    expect(process.exitCode).toBeUndefined();
  });

  it('prints warn and error lines with fixes and exits 1 on problems', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-cli-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'app.ts'), '');
    await runCli(['doctor', '--root', root]);
    expect(output(warn)).toContain('⚠');
    expect(output(error)).toContain('✗');
    expect(output(log)).toContain('fix:');
    expect(output(error)).toContain('doctor found problems');
    expect(process.exitCode).toBe(1);
  });
});

describe('runCli: extract --watch', () => {
  it('runs one extract and hands the re-runs to watchProject', async () => {
    const root = makeProject({ en: {} }, 'export const x = t`Hi`;\n');
    await runCli(['extract', '--root', root, '--watch']);
    expect(vi.mocked(watchProject)).toHaveBeenCalledTimes(1);
    expect(output(log)).toContain('watching for source changes');
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runCli: translate', () => {
  const withProvider = (root: string) => {
    writeFileSync(
      join(root, 'verbaly.config.mjs'),
      `export default { translate: { provider: async ({ targetLocale, messages }) =>
        Object.fromEntries(Object.entries(messages).map(([k, v]) =>
          [k, v.includes('{') ? 'sin params' : '[' + targetLocale + '] ' + v])) } };\n`,
    );
  };

  it('fills missing entries via the configured provider and reports rejects', async () => {
    const root = makeProject({ en: { hi: 'Hi', bad: 'Bad {x}' }, es: { hi: '', bad: '' } });
    withProvider(root);
    await runCli(['translate', '--root', root]);
    expect(output(log)).toContain('es: +1 translated');
    expect(output(warn)).toContain('es: 1 rejected (params/tags not preserved): bad');
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(es['hi']).toBe('[es] Hi');
    expect(es['bad']).toBe('');
  });

  it('--dry-run lists the missing keys without writing', async () => {
    const root = makeProject({ en: { hi: 'Hi' }, es: { hi: '' } });
    withProvider(root);
    const before = readFileSync(join(root, 'locales', 'es.json'), 'utf8');
    await runCli(['translate', '--root', root, '--dry-run']);
    expect(output(log)).toContain('es: 1 missing: hi');
    expect(readFileSync(join(root, 'locales', 'es.json'), 'utf8')).toBe(before);
  });

  it('says so when nothing is missing, resolving the default provider lazily', async () => {
    // no provider in the config: the claude provider is constructed (not called)
    const root = makeProject({ en: { hi: 'Hi' }, es: { hi: 'Hola' } });
    await runCli(['translate', '--root', root, '--dry-run']);
    expect(output(log)).toContain('nothing to translate ✓');
    log.mockClear();
    withProvider(root);
    await runCli(['translate', '--root', root]);
    expect(output(log)).toContain('nothing to translate ✓');
  });
});

describe('runCli: translate + review drafts', () => {
  const withProvider = (root: string) => {
    writeFileSync(
      join(root, 'verbaly.config.mjs'),
      `export default { translate: { provider: async ({ targetLocale, messages }) =>
        Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, '[' + targetLocale + '] ' + v])) } };\n`,
    );
  };

  it('marks machine output as a draft, review lists and approves it', async () => {
    const root = makeProject({ en: { hi: 'Hi' }, es: { hi: '' } });
    withProvider(root);
    await runCli(['translate', '--root', root]);
    expect(output(log)).toContain('es: +1 translated (draft)');
    const drafts = JSON.parse(readFileSync(join(root, 'locales', '.verbaly-drafts.json'), 'utf8'));
    expect(drafts).toEqual({ es: ['hi'] });

    log.mockClear();
    await runCli(['review', '--root', root]);
    expect(output(log)).toContain('1 machine translations awaiting review');
    expect(output(log)).toContain('es: hi');

    log.mockClear();
    await runCli(['review', '--root', root, '--approve']);
    expect(output(log)).toContain('es: 1 approved');
    expect(output(log)).toContain('1 translations marked reviewed');
    expect(existsSync(join(root, 'locales', '.verbaly-drafts.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'locales', '.verbaly-drafts.json'), 'utf8'))).toEqual(
      {},
    );
  });

  it('review says so when nothing is awaiting review', async () => {
    const root = makeProject({ en: { hi: 'Hi' }, es: { hi: 'Hola' } });
    await runCli(['review', '--root', root]);
    expect(output(log)).toContain('no machine translations awaiting review');
  });

  it('status counts unreviewed drafts', async () => {
    const root = makeProject({ en: { hi: 'Hi' }, es: { hi: '' } });
    withProvider(root);
    await runCli(['translate', '--root', root]);
    log.mockClear();
    await runCli(['status', '--root', root]);
    expect(output(log)).toContain('1 unreviewed');
  });
});

describe('runCli: check --drafts', () => {
  const withProvider = (root: string) => {
    writeFileSync(
      join(root, 'verbaly.config.mjs'),
      `export default { translate: { provider: async ({ messages }) =>
        Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, 'X ' + v])) } };\n`,
    );
  };

  it('passes by default with unreviewed drafts, fails with --drafts until approved', async () => {
    const root = makeProject({ en: { hi: 'Hi' }, es: { hi: '' } });
    withProvider(root);
    await runCli(['translate', '--root', root]);

    // default check: a draft has a value, so translations are "complete"
    await runCli(['check', '--root', root]);
    expect(output(log)).toContain('all translations complete');
    expect(process.exitCode).toBeUndefined();

    // --drafts: unreviewed machine text blocks the merge
    process.exitCode = undefined;
    await runCli(['check', '--root', root, '--drafts']);
    expect(output(error)).toContain('awaiting review');
    expect(process.exitCode).toBe(1);

    // approve, then --drafts passes
    await runCli(['review', '--root', root, '--approve']);
    process.exitCode = undefined;
    log.mockClear();
    await runCli(['check', '--root', root, '--drafts']);
    expect(output(log)).toContain('all translations complete');
    expect(process.exitCode).toBeUndefined();
  });
});

describe('runCli: export and import', () => {
  it('exports XLIFF with source locations from the registry', async () => {
    const root = makeProject({ en: {}, es: {} }, 'export const x = t`Hello there`;\n');
    await runCli(['extract', '--root', root]);
    log.mockClear();
    await runCli(['export', '--root', root]);
    expect(output(log)).toContain('exported 1 locales (xliff)');
    expect(output(log)).toContain('es: 1 messages (1 untranslated)');
    const xlf = readFileSync(join(root, 'verbaly-export', 'es.xlf'), 'utf8');
    expect(xlf).toContain('<note category="location">src/app.ts</note>');
  });

  it('says so when there are no target locales', async () => {
    const root = makeProject({ en: { a: 'A' } });
    await runCli(['export', '--root', root]);
    expect(output(log)).toContain('no target locales to export');
  });

  it('imports a CSV: fills, keeps, rejects and ignores per entry', async () => {
    const root = makeProject({
      en: { greet: 'Hello {name}', done: 'Done', extra: 'Extra' },
      es: { greet: '', done: 'Ya', extra: '' },
    });
    const csv = [
      'key,source,target',
      'greet,Hello {name},Hola {name}',
      'done,Done,Hecho',
      'extra,Extra,Extra {bad}',
      'ghost,?,Fantasma',
      '',
    ].join('\r\n');
    writeFileSync(join(root, 'es.csv'), csv);
    await runCli(['import', join(root, 'es.csv'), '--root', root]);
    expect(output(log)).toContain('es: +1 imported');
    expect(output(log)).toContain('es: 1 already translated, kept');
    expect(output(warn)).toContain('es: 1 rejected (params/tags not preserved): extra');
    expect(output(warn)).toContain('es: 1 unknown keys ignored');
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(es).toMatchObject({ greet: 'Hola {name}', done: 'Ya', extra: '' });
  });

  it('--dry-run reports what would be imported without writing', async () => {
    const root = makeProject({ en: { greet: 'Hello' }, es: { greet: '' } });
    writeFileSync(join(root, 'es.csv'), 'key,source,target\r\ngreet,Hello,Hola\r\n');
    const before = readFileSync(join(root, 'locales', 'es.json'), 'utf8');
    await runCli(['import', join(root, 'es.csv'), '--root', root, '--dry-run']);
    expect(output(log)).toContain('es: +1 would import');
    expect(readFileSync(join(root, 'locales', 'es.json'), 'utf8')).toBe(before);
  });

  it('says so when nothing lands', async () => {
    const root = makeProject({ en: { greet: 'Hello' }, es: { greet: '' } });
    writeFileSync(join(root, 'es.csv'), 'key,source,target\r\nghost,?,Fantasma\r\n');
    await runCli(['import', join(root, 'es.csv'), '--root', root]);
    expect(output(log)).toContain('nothing to import ✓');
  });

  it('clears the draft flag for imported keys (a human reviewed the file)', async () => {
    const root = makeProject({ en: { greet: 'Hello' }, es: { greet: 'borrador' } });
    writeFileSync(join(root, 'locales', '.verbaly-drafts.json'), JSON.stringify({ es: ['greet'] }));
    writeFileSync(join(root, 'es.csv'), 'key,source,target\r\ngreet,Hello,Hola\r\n');
    await runCli(['import', join(root, 'es.csv'), '--root', root, '--overwrite']);
    const drafts = JSON.parse(readFileSync(join(root, 'locales', '.verbaly-drafts.json'), 'utf8'));
    expect(drafts).toEqual({});
  });
});

describe('runCli: render', () => {
  it('mirrors the site per locale and warns about keys it could not pre-fill', async () => {
    const root = makeProject({ en: { greet: 'Hello' }, es: { greet: 'Hola' } });
    mkdirSync(join(root, 'dist'));
    writeFileSync(
      join(root, 'dist', 'index.html'),
      '<html><body><h1 data-verbaly="greet">Hello</h1><p data-verbaly="ghost">?</p></body></html>',
    );
    await runCli(['render', '--root', root]);
    expect(output(log)).toContain('1 pages × 2 locales (en, es)');
    expect(output(warn)).toContain('es: 1 keys not pre-filled: ghost');
    expect(readFileSync(join(root, 'dist', 'es', 'index.html'), 'utf8')).toContain('Hola');
  });
});

describe('runCli: pseudo', () => {
  it('writes the pseudo catalog, honoring --locale', async () => {
    const root = makeProject({ en: { a: 'Hello' } });
    await runCli(['pseudo', '--root', root]);
    expect(output(log)).toContain('1 messages pseudo-localized → en-XA');
    expect(existsSync(join(root, 'locales', 'en-XA.json'))).toBe(true);
    await runCli(['pseudo', '--root', root, '--locale', 'en-XB']);
    expect(existsSync(join(root, 'locales', 'en-XB.json'))).toBe(true);
  });
});
