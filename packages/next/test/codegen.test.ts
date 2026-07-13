import * as compiler from '@verbaly/compiler';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedDir, writeGeneratedModules as write } from '../src/codegen';

const writeGeneratedModules = write.bind(null, compiler);

function makeConfig(locales = ['en', 'es']) {
  return compiler.resolveConfig({
    root: mkdtempSync(join(tmpdir(), 'verbaly-next-')),
    sourceLocale: 'en',
    locales,
  });
}

describe('writeGeneratedModules', () => {
  it('writes the runtime module with relative locale imports', () => {
    const cfg = makeConfig();
    writeGeneratedModules(cfg, { en: { a: 'A' }, es: { a: 'Á' } });
    const dir = generatedDir(cfg.root);

    const runtime = readFileSync(join(dir, 'index.js'), 'utf8');
    expect(runtime).toContain("import source from './locale/en.js'");
    expect(runtime).toContain('"es": () => import(\'./locale/es.js\')');
    expect(runtime).not.toContain('virtual:verbaly');
    expect(runtime).toContain('export async function loadMessages(locale)');

    expect(readFileSync(join(dir, 'locale', 'en.js'), 'utf8')).toBe('export default {"a":"A"};\n');
    expect(readFileSync(join(dir, 'locale', 'es.js'), 'utf8')).toBe('export default {"a":"Á"};\n');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('embeds the request options', () => {
    const cfg = makeConfig();
    writeGeneratedModules(cfg, {}, { cookie: 'my-locale', fallback: 'es' });
    const runtime = readFileSync(join(generatedDir(cfg.root), 'index.js'), 'utf8');
    expect(runtime).toContain('export const requestOptions = {"cookie":"my-locale","fallback":"es"};');
  });

  it('is idempotent — identical content is not rewritten', () => {
    const cfg = makeConfig();
    expect(writeGeneratedModules(cfg, { en: { a: 'A' } })).toBe(true);
    const file = join(generatedDir(cfg.root), 'index.js');
    const before = statSync(file).mtimeMs;
    expect(writeGeneratedModules(cfg, { en: { a: 'A' } })).toBe(false);
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('removes locale modules that left the config', () => {
    const cfg = makeConfig();
    writeGeneratedModules(cfg, { en: {}, es: {} });
    const stale = join(generatedDir(cfg.root), 'locale', 'fr.js');
    writeFileSync(stale, 'export default {};\n');
    writeGeneratedModules(cfg, { en: {}, es: {} });
    expect(existsSync(stale)).toBe(false);
  });
});
