import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = join(import.meta.dirname, '..', 'src', 'ui');
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));

// main.ts boots the served bundle and store.svelte.ts holds a rune module, and neither is shipped
const SKIP = new Set(['main.ts', 'store.svelte.ts', 'boot.css', 'index.html', 'env.d.ts']);
const shipped = readdirSync(ui).filter((name) => !SKIP.has(name));

const IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function imports(file: string): string[] {
  const source = readFileSync(join(ui, file), 'utf8');
  return [...source.matchAll(IMPORT)].map((match) => match[1]!);
}

describe('the panel is embeddable, which is a property of what it imports', () => {
  // Proved able to fail by importing node:fs into model.ts: a host bundler cannot resolve it.
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

  // Proved able to fail by importing './store.svelte' into Panel.svelte: runes may not transform.
  it('never reaches the rune module or the boot file, which do not ship', () => {
    for (const file of shipped) {
      for (const from of imports(file)) {
        expect(`${file} -> ${from}`).not.toMatch(/store\.svelte|\.\/main/);
      }
    }
  });

  // Proved able to fail by calling fetch from Panel.svelte: the api prop would be decoration.
  it('calls the network from one file, so a host can hand it a different one', () => {
    const callers = shipped.filter((file) => /\bfetch\s*\(/.test(readFileSync(join(ui, file), 'utf8')));
    expect(callers).toEqual(['wire.ts']);
  });
});

describe('what the package says it exports', () => {
  // Proved able to fail by dropping Panel.svelte from the copy: the export points at nothing.
  it('names only files the build copies into dist/panel', () => {
    // this file and the copy script each carry the list, and a silent disagreement is the bug
    const script = readFileSync(join(import.meta.dirname, '..', 'scripts', 'copy-panel.mjs'), 'utf8');
    const declared = script.match(/const SKIP = new Set\(\[([^\]]+)\]\)/)?.[1] ?? '';
    expect([...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()).toEqual([...SKIP].sort());

    const targets = Object.values(manifest.exports as Record<string, unknown>)
      .flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry as object)))
      .filter((path): path is string => typeof path === 'string' && path.includes('/panel/'));

    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(shipped).toContain(target.replace('./dist/panel/', ''));
    }
  });

  // svelte and verbaly are only needed by a host that renders the panel, never by the command
  it('asks for svelte and verbaly as optional peers, not as dependencies', () => {
    expect(manifest.peerDependencies).toEqual({ svelte: '^5.0.0', verbaly: 'workspace:^' });
    expect(manifest.peerDependenciesMeta.svelte.optional).toBe(true);
    expect(manifest.peerDependenciesMeta.verbaly.optional).toBe(true);
    expect(Object.keys(manifest.dependencies)).toEqual(['@verbaly/compiler']);
  });
});
