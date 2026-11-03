import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// each folder imports only from itself and the folders before it
const LAYERS = ['util', 'config', 'catalog', 'scan', 'gate', 'exchange', 'emit', 'project', 'cli'];
// the two entries tsdown builds, which may import any folder
const ENTRIES = ['index.ts', 'cli.ts'];

const files = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => file.endsWith('.ts'));

const layerOf = (file: string): number => LAYERS.indexOf(file.split('/')[0]!);

// a type-only import is erased, so only what runs is a dependency here
function valueImports(file: string): string[] {
  const code = readFileSync(join(src, file), 'utf8');
  const specifiers: string[] = [];
  for (const match of code.matchAll(/^\s*(?:import|export)\b([^;]*?)\bfrom\s+'(\.[^']+)'/gm)) {
    const clause = match[1]!.trim();
    const typeOnly = clause.startsWith('type ') || /^\{(\s*type\s+\w+\s*,?)+\s*\}$/.test(clause);
    if (!typeOnly) specifiers.push(match[2]!);
  }
  for (const match of code.matchAll(/\bimport\(\s*'(\.[^']+)'\s*\)/g)) specifiers.push(match[1]!);
  return specifiers.map((spec) =>
    relative(src, resolve(dirname(join(src, file)), `${spec}.ts`)).replaceAll('\\', '/'),
  );
}

describe('the compiler src is layered by job', () => {
  it('keeps every file in a known folder, or as one of the two entries', () => {
    const stray = files.filter((file) => !ENTRIES.includes(file) && layerOf(file) === -1);
    expect(stray).toEqual([]);
  });

  it('never imports a value from a later folder', () => {
    const upward: string[] = [];
    for (const file of files) {
      for (const target of valueImports(file)) {
        expect(existsSync(join(src, target)), `${file} imports ${target}`).toBe(true);
        if (!ENTRIES.includes(file) && layerOf(target) > layerOf(file)) {
          upward.push(`${file} -> ${target}`);
        }
      }
    }
    expect(upward).toEqual([]);
  });
});
