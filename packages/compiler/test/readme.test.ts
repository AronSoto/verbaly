import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transformSource } from '../src/emit/plugin';
import { MessageRegistry } from '../src/scan/registry';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// the first example a reader runs is a claim the compiler can check: same key, same params
describe('the example the READMEs open with', () => {
  for (const file of ['README.md', 'packages/core/README.md']) {
    it(`${file} shows the key and the params the compiler writes`, () => {
      const text = readFileSync(join(repo, file), 'utf8');
      const written = /^(t`.+`);/m.exec(text)?.[1];
      const [, key, params] = /^t\('([\w-]{8})', \{ ([\w, ]+) \}\);/m.exec(text) ?? [];
      expect(written, 'the tagged template the example starts from').toBeDefined();
      expect(key, 'the call the example says the compiler writes').toBeDefined();
      const { messages, result } = transformSource(
        `${written};`,
        join(repo, 'app.ts'),
        new MessageRegistry(),
      );
      expect(Object.keys(messages)).toEqual([key]);
      for (const name of (params ?? '').split(', ')) {
        expect(result?.code).toContain(`"${name}": ${name}`);
      }
    });
  }
});

// a README naming the verbaly command installs the package that provides it, or npx finds nothing
describe('the install line of every README', () => {
  const readmes = [
    'README.md',
    ...readdirSync(join(repo, 'packages')).map((p) => `packages/${p}/README.md`),
  ];
  for (const file of readmes.filter(
    (f) => existsSync(join(repo, f)) && f !== 'packages/compiler/README.md',
  )) {
    it(`${file} installs @verbaly/compiler when it names npx verbaly`, () => {
      const text = readFileSync(join(repo, file), 'utf8');
      if (!text.includes('npx verbaly ')) return;
      const install = /```bash\n([^`]*?pnpm add [^`]*?)```/.exec(text)?.[1] ?? '';
      expect(install).toContain('@verbaly/compiler');
    });

    // Proved able to fail on the 0.79.0 Svelte and SvelteKit READMEs, which a first try followed
    it(`${file} installs what generates verbaly/app, and the CLI, when its code imports it`, () => {
      const text = readFileSync(join(repo, file), 'utf8');
      if (!text.includes("from 'verbaly/app'")) return;
      const install = /```bash\n([^`]*?pnpm add [^`]*?)```/.exec(text)?.[1] ?? '';
      expect(install).toMatch(/@verbaly\/(?:vite|unplugin|next|nuxt|astro)\b/);
      expect(install).toContain('@verbaly/compiler');
      expect(install).toMatch(/pnpm add verbaly /);
    });
  }
});

// npm shows no CI, no Scorecard and no peer range: the README of each package is where they live
describe('the badges of every package README', () => {
  for (const folder of readdirSync(join(repo, 'packages'))) {
    const text = readFileSync(join(repo, 'packages', folder, 'README.md'), 'utf8');
    const pkg = JSON.parse(
      readFileSync(join(repo, 'packages', folder, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      engines?: { node?: string };
    };

    it(`${folder} carries the family row in order, each badge naming its own package`, () => {
      const family = [
        `https://img.shields.io/npm/v/${pkg.name}?`,
        'https://img.shields.io/github/actions/workflow/status/AronSoto/verbaly/ci.yml?',
        'https://api.scorecard.dev/projects/github.com/AronSoto/verbaly/badge',
        `https://www.npmjs.com/package/${pkg.name}#provenance`,
        `https://img.shields.io/npm/l/${pkg.name}?`,
      ];
      expect(family.filter((url) => !text.includes(url))).toEqual([]);
      const order = family.map((url) => text.indexOf(url));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    // a badge shields fills from the registry reads this package, and a written one is true of it
    it(`${folder} states only what its package.json says`, () => {
      const peers = [...text.matchAll(/npm\/dependency-version\/(.+?)\/peer\/(.+?)\?/g)];
      for (const [, name, peer] of peers) {
        expect(name).toBe(pkg.name);
        expect(Object.keys(pkg.peerDependencies ?? {})).toContain(peer);
      }
      for (const [, name] of text.matchAll(/img\.shields\.io\/node\/v\/(.+?)\?/g)) {
        expect(name).toBe(pkg.name);
        expect(pkg.engines?.node).toBeDefined();
      }
      if (text.includes('badge/dependencies-0-')) {
        expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
      }
    });
  }
});
