import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config';
import {
  createOutsideCheck,
  filesOutsideInclude,
  formatOutside,
  reportOutsideInclude,
} from '../src/scope';

// create-next-app with no src/, plus shadcn: app/ is included by default and components/ is not
function nextLayout(): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-scope-'));
  mkdirSync(join(root, 'app'));
  mkdirSync(join(root, 'components'));
  mkdirSync(join(root, 'node_modules', 'lib'), { recursive: true });
  writeFileSync(join(root, 'app', 'page.tsx'), 'export const p = () => <h1>{t`Welcome`}</h1>;\n');
  writeFileSync(
    join(root, 'components', 'save.tsx'),
    "'use client';\nexport function Save() { const t = useT(); return <button>{t`Save changes`}</button>; }\n",
  );
  writeFileSync(join(root, 'node_modules', 'lib', 'x.js'), 'export const x = t`vendored`;\n');
  return root;
}

const SAVE = 'export function Save() { return <button>{t`Save changes`}</button>; }\n';

describe('a file outside include that writes t`…`', () => {
  it('is found, with the include pattern that would cover it', () => {
    const root = nextLayout();
    const cfg = resolveConfig({ root });
    const found = createOutsideCheck(cfg)(SAVE, join(root, 'components', 'save.tsx'));
    expect(found?.pattern).toBe('components/**/*.{js,jsx,ts,tsx,mjs,mts,svelte,vue,astro}');
    expect(formatOutside(cfg, found!)).toContain(
      'components/save.tsx uses t`…` outside the include of your verbaly config',
    );
    expect(formatOutside(cfg, found!)).toContain('show in en in every language');
  });

  it('names a file at the root by itself', () => {
    const root = nextLayout();
    const code = 'export const banner = t`Maintenance tonight`;\n';
    const found = createOutsideCheck(resolveConfig({ root }))(code, join(root, 'middleware.ts'));
    expect(found?.pattern).toBe('middleware.ts');
  });

  it('is only a real tagged template: text that mentions one is not', () => {
    const root = nextLayout();
    const check = createOutsideCheck(resolveConfig({ root }));
    const prose = "export const tip = 'wrap text in t`…` to translate it';\n";
    expect(check(prose, join(root, 'components', 'docs.tsx'))).toBeUndefined();
  });

  it('says nothing about a file the config includes or excludes on purpose', () => {
    const root = nextLayout();
    const cfg = resolveConfig({ root, exclude: ['components/stories/**'] });
    const check = createOutsideCheck(cfg);
    expect(check(SAVE, join(root, 'app', 'save.tsx'))).toBeUndefined();
    expect(check(SAVE, join(root, 'components', 'stories', 'save.tsx'))).toBeUndefined();
    // a linked package outside the project is not the project's source
    expect(check(SAVE, join(root, '..', 'elsewhere', 'save.tsx'))).toBeUndefined();
  });

  it('says nothing when scanning is off on purpose, the docs-site setup', () => {
    const root = nextLayout();
    const check = createOutsideCheck(resolveConfig({ root, include: [] }));
    expect(check(SAVE, join(root, 'components', 'save.tsx'))).toBeUndefined();
  });

  it('is said once per file, however often a config is evaluated', async () => {
    const root = nextLayout();
    const cfg = resolveConfig({ root });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await reportOutsideInclude(cfg);
    await reportOutsideInclude(cfg);
    const said = warn.mock.calls
      .flat()
      .filter((line) => String(line).includes('components/save.tsx'));
    expect(said).toHaveLength(1);
    warn.mockRestore();
  });

  it('is listed for doctor across the project, never inside node_modules', async () => {
    const root = nextLayout();
    const found = await filesOutsideInclude(resolveConfig({ root }));
    const files = found.map((entry) => entry.file.replaceAll('\\', '/'));
    expect(files).toEqual([join(root, 'components', 'save.tsx').replaceAll('\\', '/')]);
  });
});
