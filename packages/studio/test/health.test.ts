import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '@verbaly/compiler';
import { health } from '../src/api';

const made: string[] = [];

function project(files: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-health-'));
  made.push(root);
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(body, null, 2));
  }
  return resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Every check doctor emits must have a name here, and the map lives in a .svelte file as text.
const view = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'components', 'Health.svelte'), 'utf8');
const block = /const TITLE: Record<string, string> = \{([\s\S]*?)\n {2}\};/.exec(view)![1]!;
const NAMED = [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]!);

describe('the health view speaks for every check doctor can emit', () => {
  it('has a name for each one, on a project with problems', async () => {
    const cfg = project({
      'en.json': { a: 'Hi {name}', b: 'Bye', unused: 'Nobody says this' },
      'es.json': { a: 'Hola', b: '', unused: 'Nadie dice esto' },
    });
    mkdirSync(join(cfg.root, 'src'), { recursive: true });
    writeFileSync(join(cfg.root, 'src', 'app.ts'), 'export const x = 1;');
    const result = await health(cfg);
    const unnamed = [...new Set(result.entries.map((e) => e.check))].filter(
      (check) => !NAMED.includes(check),
    );
    expect(unnamed).toEqual([]);
    // the pin is only worth the checks it triggers, so it says which ones it saw
    expect(result.entries.length).toBeGreaterThanOrEqual(7);
  });

  // Proved able to fail by keying the list on entry.check: the view throws and never paints.
  it('reports the same check more than once, so the view cannot key a list on it', async () => {
    const cfg = project({
      'en.json': { a: 'Hi {name}', b: 'Bye' },
      'es.json': { a: 'Hola', b: '' },
    });
    const result = await health(cfg);
    const checks = result.entries.map((e) => e.check);
    expect(new Set(checks).size).toBeLessThan(checks.length);
  });

  it('carries the remedy, which is the only reason to read a diagnosis', async () => {
    const cfg = project({ 'en.json': { a: 'Hi' }, 'es.json': { a: '' } });
    const result = await health(cfg);
    expect(result.entries.filter((e) => e.level !== 'ok').every((e) => e.fix)).toBe(true);
  });
});
