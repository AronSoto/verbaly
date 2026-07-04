import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { loadCatalogs } from '../src/catalog';
import { loadConfig } from '../src/config';
import { pruneCatalogs } from '../src/extract';
import { MessageRegistry } from '../src/registry';
import { resolveConfig } from '../src/config';

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'verbaly-cfg-'));
}

describe('loadConfig', () => {
  it('reads verbaly.config.json', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"es","dir":"i18n"}');
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('es');
    expect(cfg.dir).toBe(join(root, 'i18n'));
  });

  it('reads verbaly.config.mjs', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.mjs'), "export default { sourceLocale: 'pt' };\n");
    const cfg = await loadConfig(root);
    expect(cfg.sourceLocale).toBe('pt');
  });

  it('lets overrides win', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"es"}');
    const cfg = await loadConfig(root, { sourceLocale: 'en' });
    expect(cfg.sourceLocale).toBe('en');
  });

  it('defaults without a file', async () => {
    const cfg = await loadConfig(makeRoot());
    expect(cfg.sourceLocale).toBe('en');
    expect(cfg.locales).toEqual(['en']);
  });
});

describe('pruneCatalogs', () => {
  it('drops unreferenced keys everywhere', () => {
    const root = makeRoot();
    const dir = join(root, 'locales');
    mkdirSync(dir);
    writeFileSync(join(dir, 'es.json'), '{"used":"Usada","old":"Vieja"}');
    writeFileSync(join(dir, 'en.json'), '{"used":"Used","old":"Old"}');

    const cfg = resolveConfig({ root, sourceLocale: 'es' });
    const catalogs = loadCatalogs(cfg);
    const registry = new MessageRegistry();
    registry.update('app.ts', analyze("t('used');", 'app.ts'));

    const removed = pruneCatalogs(cfg, catalogs, registry);
    expect(removed.es).toEqual(['old']);
    expect(removed.en).toEqual(['old']);
    expect(catalogs.es).toEqual({ used: 'Usada' });
  });
});
