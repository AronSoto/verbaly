import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { defaultTypesPath, installCommand, packageManager } from '../src/host';

function makeRoot(deps: Record<string, string> = {}, options: { src?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-host-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: deps }));
  if (options.src !== false) mkdirSync(join(root, 'src'));
  return root;
}

describe('where the generated types live', () => {
  it('uses the slot of each framework that has one', () => {
    const next = makeRoot({ next: '^16.0.0' });
    expect(defaultTypesPath(next)).toBe(join(next, '.verbaly', 'types.d.ts'));
    const astro = makeRoot({ astro: '^7.0.0' });
    // the path Astro gives injectTypes for @verbaly/astro, so the CLI writes the file Astro links
    expect(defaultTypesPath(astro)).toBe(
      join(astro, '.astro', 'integrations', '_verbaly_astro', 'verbaly.d.ts'),
    );
    const nuxt = makeRoot({ nuxt: '^4.0.0', vite: '^8.0.0' });
    expect(defaultTypesPath(nuxt)).toBe(join(nuxt, '.nuxt', 'verbaly.d.ts'));
  });

  it('uses src/ everywhere else, because every app template includes only src', () => {
    const vite = makeRoot({ vite: '^8.0.0' });
    expect(defaultTypesPath(vite)).toBe(join(vite, 'src', 'verbaly.d.ts'));
    const kit = makeRoot({ '@sveltejs/kit': '^3.0.0', vite: '^8.0.0' });
    expect(defaultTypesPath(kit)).toBe(join(kit, 'src', 'verbaly.d.ts'));
    const webpack = makeRoot({ webpack: '^5.0.0' });
    expect(defaultTypesPath(webpack)).toBe(join(webpack, 'src', 'verbaly.d.ts'));
  });

  it('falls back to the root only when there is no src/', () => {
    const bare = makeRoot({}, { src: false });
    expect(defaultTypesPath(bare)).toBe(join(bare, 'verbaly.d.ts'));
  });

  it('is decided once by resolveConfig, and the config still wins', () => {
    const next = makeRoot({ next: '^16.0.0' });
    expect(resolveConfig({ root: next }).dts).toBe(join(next, '.verbaly', 'types.d.ts'));
    expect(resolveConfig({ root: next, dts: 'types/i18n.d.ts' }).dts).toBe(
      join(next, 'types', 'i18n.d.ts'),
    );
    expect(resolveConfig({ root: next, dts: false }).dts).toBe(false);
  });
});

describe('the install line init and doctor print', () => {
  it('reads packageManager first, then the nearest lockfile, and npm when there is neither', () => {
    const declared = makeRoot();
    writeFileSync(join(declared, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.9.0' }));
    writeFileSync(join(declared, 'pnpm-lock.yaml'), '');
    expect(packageManager(declared)).toBe('yarn');

    const locked = makeRoot();
    writeFileSync(join(locked, 'bun.lock'), '');
    expect(packageManager(locked)).toBe('bun');

    // a workspace keeps one lockfile at its root, above the app being set up
    const workspace = mkdtempSync(join(tmpdir(), 'verbaly-ws-'));
    writeFileSync(join(workspace, 'pnpm-lock.yaml'), '');
    const app = join(workspace, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'package.json'), '{}');
    expect(packageManager(app)).toBe('pnpm');
  });

  it('installs what the README installs, as dependencies, in the manager the project uses', () => {
    const root = makeRoot();
    writeFileSync(join(root, 'package-lock.json'), '{}');
    expect(installCommand(root, ['verbaly', '@verbaly/next', '@verbaly/react'])).toBe(
      'npm install verbaly @verbaly/next @verbaly/react',
    );
    expect(installCommand(root, ['@verbaly/compiler'], true)).toBe(
      'npm install -D @verbaly/compiler',
    );
    const bun = makeRoot();
    writeFileSync(join(bun, 'bun.lockb'), '');
    expect(installCommand(bun, ['@verbaly/compiler'], true)).toBe('bun add -d @verbaly/compiler');
  });
});
