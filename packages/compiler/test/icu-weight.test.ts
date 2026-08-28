import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { generateRuntimeModule } from '../src/codegen';

// esbuild runs twice against the real core build, so this file pays for a bundler, not a unit
const BUNDLE_TIMEOUT = 30_000;

const coreDist = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'core',
  'dist',
  'index.js',
);

// a codegen assertion proves the import is not written; only a real bundle proves it is not shipped
async function weigh(icu: boolean): Promise<{ bytes: number; code: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'verbaly-icu-'));
  try {
    mkdirSync(join(dir, 'locale'), { recursive: true });
    writeFileSync(join(dir, 'locale', 'en.js'), 'export default { a: "Hi" };\n');
    writeFileSync(join(dir, 'locale', 'es.js'), 'export default { a: "Hola" };\n');
    const cfg = resolveConfig({ root: dir, sourceLocale: 'en', locales: ['en', 'es'] });
    writeFileSync(
      join(dir, 'runtime.js'),
      generateRuntimeModule(cfg, { icu, localeImport: (l) => `./locale/${l}.js` }),
    );
    writeFileSync(join(dir, 'app.js'), "import { t } from './runtime.js';\nconsole.log(t('a'));\n");

    const result = await build({
      entryPoints: [join(dir, 'app.js')],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      alias: { verbaly: coreDist },
    });
    const code = result.outputFiles[0]!.text;
    return { bytes: gzipSync(Buffer.from(code), { level: 9 }).length, code };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the ICU parser is weight an app opts into', { timeout: BUNDLE_TIMEOUT }, () => {
  it('is not in the bundle of an app whose catalogs never use it', async () => {
    const off = await weigh(false);
    const on = await weigh(true);

    // "offset:" is only in parseIcu; selectordinal is in isIcu's regex, which stays in core
    expect(off.code).not.toContain('offset:');
    expect(on.code).toContain('offset:');
    expect(on.bytes).toBeGreaterThan(off.bytes);
  });

  it('costs enough to be worth not shipping', async () => {
    const off = await weigh(false);
    const on = await weigh(true);
    // measured at 544 B when this landed: the floor guards the claim, not the exact number
    expect(on.bytes - off.bytes).toBeGreaterThan(400);
  });
});
