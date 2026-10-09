import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { detectHost } from '../src/host';
import { init } from '../src/init';

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'verbaly-init-'));
}

describe('init', () => {
  it('scaffolds config + source catalog with defaults', async () => {
    const root = makeRoot();
    const result = await init({ root });
    expect(result.created).toEqual(['verbaly.config.mjs', 'locales/en.json']);
    expect(result.skipped).toEqual([]);
    expect(readFileSync(join(root, 'locales/en.json'), 'utf8')).toBe('{}\n');
  });

  it('writes a loadable config honoring flags', async () => {
    const root = makeRoot();
    await init({ root, sourceLocale: 'es', locales: ['en', 'pt'], dir: 'i18n' });
    for (const locale of ['es', 'en', 'pt']) {
      expect(existsSync(join(root, `i18n/${locale}.json`))).toBe(true);
    }
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('es');
    expect(cfg.dir).toBe(join(root, 'i18n'));
    expect(cfg.locales).toEqual(expect.arrayContaining(['es', 'en', 'pt']));
  });

  it('emits a .ts config when tsconfig.json exists', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    const result = await init({ root });
    expect(result.configFile).toBe('verbaly.config.ts');
    const source = readFileSync(join(root, 'verbaly.config.ts'), 'utf8');
    expect(source).toContain('satisfies VerbalyConfig');
  });

  it('never overwrites an existing config or catalog', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"fr"}');
    await init({ root, locales: ['de'] });
    const result = await init({ root, locales: ['de'] });
    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(['verbaly.config.json', 'locales/fr.json', 'locales/de.json']);
    expect(readFileSync(join(root, 'verbaly.config.json'), 'utf8')).toBe('{"sourceLocale":"fr"}');
  });

  it('scaffolds where an existing config says, not where the defaults would', async () => {
    // the config is the answer to both questions init was guessing: a second set is the bug
    const root = makeRoot();
    writeFileSync(
      join(root, 'verbaly.config.json'),
      '{"dir":"locale","sourceLocale":"es","locales":["es"]}',
    );
    const result = await init({ root });
    expect(result.created).toEqual(['locale/es.json']);
    expect(existsSync(join(root, 'locales'))).toBe(false);
    expect(existsSync(join(root, 'locale/en.json'))).toBe(false);
  });

  it('lets a flag win over the config file it read', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.json'), '{"dir":"locale","sourceLocale":"es"}');
    const result = await init({ root, dir: 'i18n' });
    expect(result.created).toEqual(['i18n/es.json']);
  });

  it('dedupes the source locale from --locales', async () => {
    const root = makeRoot();
    const result = await init({ root, locales: ['en', 'es'] });
    expect(result.created.filter((f) => f === 'locales/en.json')).toHaveLength(1);
  });

  it('detects vite and suggests @verbaly/vite', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'package.json'), '{"devDependencies":{"vite":"^8.0.0"}}');
    const result = await init({ root });
    expect(result.host).toBe('vite');
    expect(result.next.join(' ')).toContain('@verbaly/vite');
  });

  it('routes other bundlers to @verbaly/unplugin', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'package.json'), '{"devDependencies":{"webpack":"^5.0.0"}}');
    expect(detectHost(root)?.name).toBe('webpack');
    expect((await init({ root })).next.join(' ')).toContain('@verbaly/unplugin');
  });

  it('picks the meta-framework over the bundler it runs on', async () => {
    // a Nuxt or SvelteKit app also has vite: the vite plugin alone skips their integration
    const nuxt = makeRoot();
    writeFileSync(join(nuxt, 'package.json'), '{"dependencies":{"nuxt":"^4.0.0","vite":"^8.0.0"}}');
    expect(detectHost(nuxt)?.pkg).toBe('@verbaly/nuxt');
    expect((await init({ root: nuxt })).next.join(' ')).toContain('nuxt.config');

    const kit = makeRoot();
    writeFileSync(join(kit, 'package.json'), '{"devDependencies":{"@sveltejs/kit":"^2.0.0"}}');
    expect(detectHost(kit)?.name).toBe('sveltekit');
    expect(detectHost(kit)?.pkg).toBe('@verbaly/vite');
  });

  it('falls back to CLI guidance without a bundler', async () => {
    const root = makeRoot();
    const result = await init({ root });
    expect(result.host).toBeUndefined();
    expect(result.next.join(' ')).toContain('verbaly extract');
  });
});

describe('init in a project that already translates', () => {
  // what Memos looked like: react-i18next, Vite, and a <locale>.json per language in src/locales
  function moving(): string {
    const root = makeRoot();
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { i18next: '^26.0.0', 'react-i18next': '^17.0.0', verbaly: '^0.70.0' },
        devDependencies: { vite: '^8.0.0', '@verbaly/vite': '^0.70.0' },
      }),
    );
    mkdirSync(join(root, 'src', 'locales'), { recursive: true });
    writeFileSync(join(root, 'src', 'locales', 'en.json'), '{"hi":"Hi {{name}}"}');
    writeFileSync(join(root, 'src', 'locales', 'es.json'), '{"hi":"Hola {{name}}"}');
    return root;
  }

  // Proved able to fail without the look around: an empty locales/en.json beside 46 catalogs.
  it('points the config at the catalogs it has, and scaffolds no second set', async () => {
    const root = moving();
    const result = await init({ root });

    expect(result.found).toBe('src/locales');
    expect(result.created).toEqual(['verbaly.config.mjs']);
    expect(result.skipped).toEqual(['src/locales/en.json']);
    expect(existsSync(join(root, 'locales'))).toBe(false);
    const cfg = await loadConfig(root);
    expect(cfg.dir).toBe(join(root, 'src', 'locales'));
    expect(cfg.locales).toEqual(['en', 'es']);
  });

  it('names migrate for those catalogs, and installs nothing that is already installed', async () => {
    const result = await init({ root: moving() });

    expect(result.next).toEqual([
      'add verbaly() to the plugins in vite.config',
      'port the i18next and react-i18next catalogs: npx verbaly migrate reports, --write applies',
    ]);
  });

  it('looks around only for a config it writes, never past a --dir or a config file', async () => {
    const flagged = moving();
    expect((await init({ root: flagged, dir: 'i18n' })).found).toBeUndefined();
    const configured = moving();
    writeFileSync(join(configured, 'verbaly.config.json'), '{"dir":"translations"}');
    expect((await init({ root: configured })).found).toBeUndefined();
  });
});

describe('init: a locale is written the way Intl reads it', () => {
  // Proved able to fail by taking the flags as typed: pt_BR.json lands and Intl rejects the name.
  it('writes pt-BR for pt_BR and says so, and leaves out a flag with no sure fix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-init-tag-'));
    const result = await init({ root, locales: ['pt_BR', 'x'] });
    expect(result.renamed).toEqual([{ from: 'pt_BR', to: 'pt-BR' }]);
    expect(result.refused).toEqual(['x']);
    expect(existsSync(join(root, 'locales', 'pt-BR.json'))).toBe(true);
    expect(existsSync(join(root, 'locales', 'pt_BR.json'))).toBe(false);
    expect(existsSync(join(root, 'locales', 'x.json'))).toBe(false);
    expect(readFileSync(join(root, result.configFile), 'utf8')).toContain("locales: ['pt-BR']");
  });

  // Proved able to fail by keeping both spellings: the config lists pt-BR twice.
  it('lists a locale once when two spellings of it were typed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-init-tag-'));
    const result = await init({ root, locales: ['pt_BR', 'pt-BR'] });
    expect(readFileSync(join(root, result.configFile), 'utf8')).toContain("locales: ['pt-BR'],");
  });

  it('refuses a source locale it cannot name, since there is no project without one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-init-tag-'));
    await expect(init({ root, sourceLocale: 'x' })).rejects.toThrow(/"x" is not a locale tag/);
  });
});

describe('the install line init prints', () => {
  it('is the one the README teaches, as dependencies, in the manager the project uses', async () => {
    const pnpm = makeRoot();
    writeFileSync(
      join(pnpm, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16.0.0' } }),
    );
    writeFileSync(join(pnpm, 'pnpm-lock.yaml'), '');
    const fromPnpm = await init({ root: pnpm });
    expect(fromPnpm.next[0]).toBe('pnpm add verbaly @verbaly/next @verbaly/react');

    const npm = makeRoot();
    writeFileSync(join(npm, 'package.json'), JSON.stringify({ dependencies: { nuxt: '^4.0.0' } }));
    writeFileSync(join(npm, 'package-lock.json'), '{}');
    const fromNpm = await init({ root: npm });
    expect(fromNpm.next[0]).toBe('npm install verbaly @verbaly/nuxt @verbaly/vue');
  });
});
