import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { transformSource } from '../src/plugin';
import { MessageRegistry } from '../src/registry';

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
  }
});
