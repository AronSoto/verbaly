import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalogs } from '../src/catalog/catalog';
import { loadState } from '../src/catalog/lock';
import { resolveConfig } from '../src/config/config';
import { renderSite } from '../src/emit/site';
import { translateCatalogs, type TranslateProvider } from '../src/exchange/translate';
import { check } from '../src/gate/check';
import { status } from '../src/gate/status';
import { syncProject } from '../src/project/project';
import { extractProject } from '../src/scan/extract';
import { stableKey } from '../src/util/key';

const key = stableKey('Hello');

// a catalog file is all it takes: with no locales declared, every file in the folder is one
function project(locale: string) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-names-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'locales', 'en.json'), '{}');
  writeFileSync(join(root, 'locales', `${locale}.json`), '{}');
  writeFileSync(join(root, 'src', 'app.ts'), "import { t } from 'verbaly';\nt`Hello`;\n");
  writeFileSync(join(root, 'dist', 'index.html'), '<html><body><p>x</p></body></html>');
  return resolveConfig({ root, sourceLocale: 'en' });
}

const upper: TranslateProvider = (request) =>
  Promise.resolve(
    Object.fromEntries(Object.entries(request.messages).map(([k, v]) => [k, v.toUpperCase()])),
  );

// the runtime keeps every locale in a map with no prototype, so the compiler has to as well
describe.each(['__proto__', 'constructor', 'toString'])('a locale named %s', (locale) => {
  // Proved able to fail with {} as the map: check dropped __proto__, translate and render threw.
  it('is a locale like any other from extract to the mirror', async () => {
    const cfg = project(locale);
    expect(cfg.locales).toEqual(['en', locale]);
    await syncProject(cfg);
    expect(JSON.parse(readFileSync(join(cfg.dir, `${locale}.json`), 'utf8'))).toEqual({
      [key]: '',
    });

    const registry = await extractProject(cfg);
    const missing = check(cfg, loadCatalogs(cfg), registry, loadState(cfg).fingerprints).missing;
    expect(missing.map((entry) => entry.locale)).toEqual([locale]);
    const counted = status(cfg, loadCatalogs(cfg), registry).locales.map((row) => row.locale);
    expect(counted).toContain(locale);

    const catalogs = loadCatalogs(cfg);
    const result = await translateCatalogs(cfg, catalogs, upper);
    expect(Object.entries(result.translated)).toEqual([[locale, [key]]]);
    expect(Object.hasOwn(catalogs, locale) && catalogs[locale]![key]).toBe('HELLO');

    const rendered = await renderSite(cfg);
    expect(rendered.locales).toEqual(['en', locale]);
    expect(existsSync(join(cfg.root, 'dist', locale, 'index.html'))).toBe(true);
  });
});
