import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { detectHost, init } from '../src/init';

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
