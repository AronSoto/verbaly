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
  catalogs?: Record<string, Record<string, unknown> | string>; // string = raw file content
  code?: string;
  dts?: boolean;
  pkg?: Record<string, unknown>;
  include?: string[];
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
      writeFileSync(join(root, 'verbaly.d.ts'), generateDts(source as Record<string, string>));
    }
  }
  if (options.pkg) {
    writeFileSync(join(root, 'package.json'), JSON.stringify(options.pkg));
  }
  return resolveConfig({ root, sourceLocale: 'es', include: options.include });
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

  it('accepts a nested catalog and names the path of a bad leaf', async () => {
    // rejecting nested trees made the docs site fail its own doctor while its build passed
    const nested = await doctor(
      makeProject({
        catalogs: { es: { nav: { home: 'Inicio' } }, en: { nav: { home: 'Home' } } },
        code: '',
        dts: false,
      }),
    );
    expect(nested.ok).toBe(true);
    expect(entry(nested.entries, 'locale es')).toBeUndefined();
    expect(entry(nested.entries, 'translations')?.message).toBe('all translations complete');

    const bad = await doctor(
      makeProject({ catalogs: { es: { nav: { count: 3 } } }, code: '', dts: false }),
    );
    expect(bad.ok).toBe(false);
    expect(entry(bad.entries, 'locale es')?.message).toContain('non-string value at "nav.count"');
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

  it('recommends the integration of the host it detected, like init does', async () => {
    // every non-vite project used to be sent to unplugin, the opposite of what init had said
    const astro = await doctor(makeProject({ pkg: { dependencies: { astro: '^7.0.0' } } }));
    expect(entry(astro.entries, 'plugin')?.fix).toContain('@verbaly/astro');

    const nuxt = await doctor(makeProject({ pkg: { dependencies: { nuxt: '^4.0.0' } } }));
    expect(entry(nuxt.entries, 'plugin')?.fix).toContain('@verbaly/nuxt');

    // a meta-framework wins over the bundler underneath it
    const next = await doctor(
      makeProject({ pkg: { dependencies: { next: '^16.0.0', vite: '^8.0.0' } } }),
    );
    expect(entry(next.entries, 'plugin')?.message).toContain('next');
    expect(entry(next.entries, 'plugin')?.fix).toContain('@verbaly/next');

    // wired with any of them counts: the astro integration wraps the vite plugin
    const viteInAstro = await doctor(
      makeProject({ pkg: { dependencies: { astro: '^7.0.0', '@verbaly/vite': '^0.30.0' } } }),
    );
    expect(entry(viteInAstro.entries, 'plugin')?.level).toBe('ok');
  });

  it('reports broken translations, so it cannot call a failing build healthy', async () => {
    const result = await doctor(
      makeProject({
        catalogs: { es: { [KEY]: 'Hola {name}' }, en: { [KEY]: 'Hello' } },
        dts: true,
      }),
    );
    const e = result.entries.find((x) => x.check === 'translations' && x.level === 'error');
    expect(e?.message).toContain('1 broken translation (en)');
    expect(e?.fix).toContain('verbaly check');
    expect(result.ok).toBe(false); // check exits 1 on this project, doctor now agrees
  });

  it('reports structural warnings without failing', async () => {
    const plural = '{count | one: un elemento | other: # elementos}';
    const cfg = makeProject({
      catalogs: { es: { [KEY]: plural }, pl: { [KEY]: plural } },
      code: '',
      dts: false,
    });
    const result = await doctor(cfg);
    const e = result.entries.find((x) => x.check === 'translations' && x.level === 'warn');
    expect(e?.message).toContain('structural');
    expect(result.ok).toBe(true);
  });

  it('stays quiet about orphans and types when source scanning is off', async () => {
    // with no code read, claiming orphans would push a --prune that deletes a working catalog
    const result = await doctor(
      makeProject({ catalogs: { es: { hand: 'Escrito a mano' } }, dts: false, include: [] }),
    );
    expect(entry(result.entries, 'sources')?.message).toContain('include: []');
    expect(entry(result.entries, 'orphans')).toBeUndefined();
    expect(entry(result.entries, 'types')).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it('errors on t imported from a verbaly package, which only the bundler used to catch', async () => {
    const cfg = makeProject({ code: "import { t } from 'verbaly';\n", dts: false });
    const result = await doctor(cfg);
    const e = entry(result.entries, 'imports');
    expect(e?.level).toBe('error');
    expect(e?.message).toContain('src/app.ts');
    expect(e?.fix).toContain('useT()');
    expect(result.ok).toBe(false);
  });

  it('warns when an extracted message keeps a block as literal text', async () => {
    const cfg = makeProject({
      code: 'const s = t`You have {count | one: 1 item | other: # items}`;\n',
      catalogs: { es: {} },
      dts: false,
    });
    const result = await doctor(cfg);
    const e = entry(result.entries, 'messages');
    expect(e?.level).toBe('warn');
    expect(e?.message).toContain('{{count | one: 1 item | other: # items}}');
    expect(e?.fix).toContain('t(key, params)');
  });

  it('says nothing about imports or messages when the code is clean', async () => {
    const result = await doctor(makeProject());
    expect(entry(result.entries, 'imports')).toBeUndefined();
    expect(entry(result.entries, 'messages')).toBeUndefined();
    expect(entry(result.entries, 'sources')).toBeUndefined();
  });

  it('names the file it could not parse and still finishes every other check', async () => {
    const cfg = makeProject();
    writeFileSync(join(cfg.root, 'src', 'broken.ts'), 'const a = ;;;function(');
    const result = await doctor(cfg);
    const e = entry(result.entries, 'sources');
    expect(e?.level).toBe('warn');
    expect(e?.message).toContain('src/broken.ts');
    // a dialect babel cannot read still builds in the project, so this can never fail a ci
    expect(result.ok).toBe(true);
    expect(entry(result.entries, 'translations')?.message).toBe('all translations complete');
  });
});

describe('doctor: the url mode has a name now', () => {
  const routingOf = async (cfg: ReturnType<typeof makeProject>) =>
    (await doctor(cfg)).entries.find((entry) => entry.check === 'routing');

  it('says which mode the project is in, and that nobody wrote it down', async () => {
    const entry = await routingOf(makeProject());
    expect(entry?.level).toBe('ok');
    expect(entry?.message).toContain('no-prefix');
    expect(entry?.message).toContain('from your setup, no routing set');
    expect(entry?.message).toContain('one address serves every locale');
  });

  it('reads a mode the config names as a choice, not an inference', async () => {
    const root = makeProject();
    writeFileSync(join(root.root, 'verbaly.config.json'), '{"routing":"prefix-all"}');
    const entry = await routingOf({ ...root, routing: 'prefix-all' });
    expect(entry?.message).toContain('prefix-all');
    expect(entry?.message).not.toContain('from your setup');
  });

  it('names the contradiction between no-prefix and a render section', async () => {
    const base = makeProject();
    const entry = await routingOf({ ...base, routing: 'no-prefix', render: { sitemap: true } });
    // a warn and not an error: it builds and it renders, it just disagrees with itself
    expect(entry?.level).toBe('warn');
    expect(entry?.message).toContain('render writes one url tree per locale');
    expect(entry?.fix).toContain('prefix-except-source');
  });

  it('a no-prefix project without render is simply in that mode', async () => {
    const base = makeProject();
    const entry = await routingOf({ ...base, routing: 'no-prefix' });
    expect(entry?.level).toBe('ok');
    expect(entry?.message).toContain('one address serves every locale');
  });
});
