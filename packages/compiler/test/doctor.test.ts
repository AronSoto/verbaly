import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDts } from '../src/codegen';
import { resolveConfig } from '../src/config';
import { doctor, type DoctorEntry } from '../src/doctor';
import { stableKey } from '../src/key';

const KEY = stableKey('Hola {name}');

interface ProjectOptions {
  config?: boolean;
  catalogs?: Record<string, Record<string, string> | string>; // string = raw file content
  code?: string;
  dts?: boolean;
  pkg?: Record<string, unknown>;
}

function makeProject(options: ProjectOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-doctor-'));
  if (options.config !== false) {
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"es"}');
  }
  const catalogs = options.catalogs ?? { es: { [KEY]: 'Hola {name}' } };
  mkdirSync(join(root, 'locales'), { recursive: true });
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const content = typeof catalog === 'string' ? catalog : JSON.stringify(catalog);
    writeFileSync(join(root, 'locales', `${locale}.json`), content);
  }
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), options.code ?? 'const s = t`Hola ${name}`;\n');
  if (options.dts !== false) {
    const source = catalogs['es'];
    if (typeof source === 'object') {
      writeFileSync(join(root, 'verbaly.d.ts'), generateDts(source));
    }
  }
  if (options.pkg) {
    writeFileSync(join(root, 'package.json'), JSON.stringify(options.pkg));
  }
  return resolveConfig({ root, sourceLocale: 'es' });
}

function entry(entries: DoctorEntry[], check: string): DoctorEntry | undefined {
  return entries.find((e) => e.check === check);
}

describe('doctor', () => {
  it('reports a healthy setup', async () => {
    const result = await doctor(makeProject());
    expect(result.ok).toBe(true);
    expect(result.entries.every((e) => e.level === 'ok')).toBe(true);
    expect(entry(result.entries, 'config')?.message).toContain('verbaly.config.json');
    expect(entry(result.entries, 'translations')?.message).toBe('all translations complete');
  });

  it('warns without a config file and points to init', async () => {
    const result = await doctor(makeProject({ config: false }));
    const e = entry(result.entries, 'config');
    expect(e?.level).toBe('warn');
    expect(e?.fix).toContain('verbaly init');
    expect(result.ok).toBe(true); // warns don't fail
  });

  it('errors on a missing catalogs directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-doctor-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), '');
    const result = await doctor(resolveConfig({ root, sourceLocale: 'es' }));
    expect(result.ok).toBe(false);
    expect(entry(result.entries, 'catalogs')?.level).toBe('error');
  });

  it('errors on a missing locale file', async () => {
    const cfg = makeProject();
    cfg.locales.push('pt'); // configured but never created
    const result = await doctor(cfg);
    expect(result.ok).toBe(false);
    expect(entry(result.entries, 'locale pt')?.message).toContain('missing');
  });

  it('errors on corrupt JSON and non-string values', async () => {
    const result = await doctor(
      makeProject({
        catalogs: {
          es: { [KEY]: 'Hola {name}' },
          en: '{corrupt',
          pt: '{"a": 3}',
        },
        dts: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(entry(result.entries, 'locale en')?.message).toContain('not valid JSON');
    expect(entry(result.entries, 'locale pt')?.message).toContain('non-string value at "a"');
  });

  it('warns on an empty source catalog', async () => {
    const result = await doctor(makeProject({ catalogs: { es: {} }, code: '', dts: false }));
    const e = entry(result.entries, 'source');
    expect(e?.level).toBe('warn');
    expect(e?.fix).toContain('verbaly extract');
  });

  it('warns when verbaly.d.ts is missing or stale', async () => {
    const missing = await doctor(makeProject({ dts: false }));
    expect(entry(missing.entries, 'types')?.message).toContain('not been generated');

    const cfg = makeProject();
    writeFileSync(join(cfg.root, 'verbaly.d.ts'), '// old\n');
    const stale = await doctor(cfg);
    expect(entry(stale.entries, 'types')?.message).toContain('stale');
    expect(entry(stale.entries, 'types')?.fix).toContain('verbaly extract');
  });

  it('flags orphan keys with a prune fix', async () => {
    const result = await doctor(
      makeProject({
        catalogs: { es: { [KEY]: 'Hola {name}', vieja: 'Ya no' } },
        dts: false,
      }),
    );
    const e = entry(result.entries, 'orphans');
    expect(e?.level).toBe('warn');
    expect(e?.message).toContain('vieja');
    expect(e?.fix).toContain('--prune');
  });

  it('errors on unknown keys used in code', async () => {
    const result = await doctor(makeProject({ code: "t('ghost.key');\n", dts: true }));
    expect(result.ok).toBe(false);
    expect(entry(result.entries, 'keys')?.message).toContain('ghost.key');
  });

  it('warns on missing translations', async () => {
    const result = await doctor(
      makeProject({ catalogs: { es: { [KEY]: 'Hola {name}' }, en: { [KEY]: '' } } }),
    );
    const e = entry(result.entries, 'translations');
    expect(e?.level).toBe('warn');
    expect(e?.message).toContain('en');
    expect(result.ok).toBe(true);
  });

  it('checks the bundler plugin wiring', async () => {
    const unwired = await doctor(makeProject({ pkg: { devDependencies: { vite: '^8.0.0' } } }));
    const e = entry(unwired.entries, 'plugin');
    expect(e?.level).toBe('warn');
    expect(e?.fix).toContain('@verbaly/vite');

    const wired = await doctor(
      makeProject({ pkg: { devDependencies: { vite: '^8.0.0', '@verbaly/vite': '^0.13.0' } } }),
    );
    expect(entry(wired.entries, 'plugin')?.level).toBe('ok');

    const webpack = await doctor(makeProject({ pkg: { devDependencies: { webpack: '^5.0.0' } } }));
    expect(entry(webpack.entries, 'plugin')?.fix).toContain('@verbaly/unplugin');

    const none = await doctor(makeProject());
    expect(entry(none.entries, 'plugin')?.message).toContain('CLI flow');
  });
});
