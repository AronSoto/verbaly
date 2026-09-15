import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = join(import.meta.dirname, '..', 'src', 'ui');
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));

// main.ts and store.svelte.ts boot the bundle, so they are the shell around everything else
const BOOT = new Set(['main.ts', 'store.svelte.ts', 'index.html', 'env.d.ts']);
const root = readdirSync(ui, { withFileTypes: true });
const logic = root.filter((e) => e.isFile() && !BOOT.has(e.name)).map((e) => e.name);
const views = readdirSync(join(ui, 'components')).map((name) => `components/${name}`);
const sheets = readdirSync(join(ui, 'css'));
const shipped = [...logic, ...views];

const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function imports(file: string): string[] {
  const source = readFileSync(join(ui, file), 'utf8');
  return [...source.matchAll(IMPORT)].map((match) => match[1]!);
}

describe('the panel is a browser bundle, which is a property of what it imports', () => {
  // Proved able to fail by importing node:fs into model.ts: vite would ship it to a browser.
  it('reaches for nothing but svelte, verbaly and its own files', () => {
    const outside = new Map<string, string[]>();
    for (const file of shipped) {
      const strays = imports(file).filter(
        (from) => !from.startsWith('.') && from !== 'svelte' && from !== 'verbaly',
      );
      if (strays.length) outside.set(file, strays);
    }
    expect(Object.fromEntries(outside)).toEqual({});
  });

  // Proved able to fail by importing './store.svelte' into Panel.svelte: state arrives as a prop.
  it('never reaches the boot module, because its state and its api are handed to it', () => {
    for (const file of shipped) {
      for (const from of imports(file)) {
        expect(`${file} -> ${from}`).not.toMatch(/store\.svelte|\.\/main/);
      }
    }
  });

  // Proved able to fail by calling fetch from Panel.svelte: the api prop would be decoration.
  it('calls the network from one file, so a test can hand it a different one', () => {
    const callers = shipped.filter((file) =>
      /\bfetch\s*\(/.test(readFileSync(join(ui, file), 'utf8')),
    );
    expect(callers).toEqual(['wire.ts']);
  });
});

describe('the module keeps its shape, so a new file has one obvious home', () => {
  // Proved able to fail by leaving a .svelte at the root of ui: the filter finds it.
  it('keeps every component in components/ and every stylesheet in css/', () => {
    const strays = logic.filter((name) => name.endsWith('.svelte') || name.endsWith('.css'));
    expect(strays).toEqual([]);
    expect(views.every((name) => name.endsWith('.svelte'))).toBe(true);
    expect(sheets.every((name) => name.endsWith('.css'))).toBe(true);
  });

  it('leaves the root of ui for the logic the components are handed', () => {
    expect([...logic].sort()).toEqual([
      'api.ts',
      'model.ts',
      'validate.ts',
      'wire.ts',
      'words.ts',
    ]);
  });
});

describe('what the package says it exports', () => {
  // 0.56.0 published the panel as source for one consumer, our own demo, and 0.57.0 took it back.
  it('is one entry, because Studio is a command and not a component library', () => {
    expect(Object.keys(manifest.exports)).toEqual(['.']);
    expect(Object.keys(manifest.bin)).toEqual(['verbaly-studio']);
  });

  // Proved able to fail by re-adding svelte: a peer is a question the reader has to answer.
  it('asks the reader to install nothing, so the command is the whole contract', () => {
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.peerDependenciesMeta).toBeUndefined();
    expect(Object.keys(manifest.dependencies)).toEqual(['@verbaly/compiler']);
  });

  // the served panel is built, so nothing under src/ui can be named by an export path
  it('ships dist only, with the panel already compiled into it', () => {
    expect(manifest.files).toEqual(['dist', 'LICENSE']);
    const targets = JSON.stringify(manifest.exports);
    expect(targets).not.toMatch(/\.svelte|\/panel\//);
  });
});
