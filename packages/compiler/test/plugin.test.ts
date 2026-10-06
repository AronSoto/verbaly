import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config';
import { stableKey } from '../src/key';
import { runBuildGate, transformSource } from '../src/plugin';
import { MessageRegistry } from '../src/registry';

const KEY = stableKey('Hola {name}');

describe('transformSource', () => {
  it('returns the file messages as a catalog, not the analysis behind them', () => {
    const registry = new MessageRegistry();
    const { messages, result } = transformSource(
      'const s = t`Hola ${name}`;',
      'src/app.ts',
      registry,
    );
    expect(messages).toEqual({ [KEY]: 'Hola {name}' });
    expect(result?.code).toContain(JSON.stringify(KEY));
  });

  it('registers the file so the gate sees it', () => {
    const registry = new MessageRegistry();
    transformSource('const s = t`Hola ${name}`;', 'src/app.ts', registry);
    expect([...registry.messages().keys()]).toEqual([KEY]);
  });

  it('keeps the first message for a repeated explicit key, like the registry does', () => {
    const registry = new MessageRegistry();
    const code = "const a = t.id('greet')`One`;\nconst b = t.id('greet')`Two`;";
    expect(transformSource(code, 'src/app.ts', registry).messages).toEqual({ greet: 'One' });
  });

  it('returns no messages and no rewrite for a file with nothing to extract', () => {
    const registry = new MessageRegistry();
    const { messages, result } = transformSource('export const n = 1;', 'src/app.ts', registry);
    expect(messages).toEqual({});
    expect(result).toBeNull();
  });

  it('hands an unparseable file back untouched and says so once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new MessageRegistry();
    const code = 'const a = ;;;function(';
    const { messages, result } = transformSource(code, 'src/unreadable.ts', registry);
    expect(messages).toEqual({});
    expect(result).toBeNull();
    transformSource(code, 'src/unreadable.ts', registry);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('src/unreadable.ts: could not be parsed');
    expect(registry.parseErrors()).toHaveLength(1);
    warn.mockRestore();
  });
});

describe('runBuildGate: what a build says about warnings', () => {
  function project(es: string) {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-gate-'));
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'locales', 'en.json'), '{"a":"{n | one: # item | other: # items}"}');
    writeFileSync(join(root, 'locales', 'es.json'), es);
    return resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
  }

  // the dedupe is per process, so the quiet case runs before the one that prints
  it('says nothing when check has nothing to say', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const es = '{"a":"{n | one: # cosa | other: # cosas}"}';
    expect(() => runBuildGate(project(es), new MessageRegistry())).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // Proved able to fail without the line: a key only a translation has built in silence.
  it('says in one line that check has warnings, and the build still passes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const es = '{"a":"{n | one: # cosa | other: # cosas}","stray":"Sobra"}';
    expect(() => runBuildGate(project(es), new MessageRegistry())).not.toThrow();
    expect(warn.mock.calls.map(([text]) => String(text))).toEqual([
      '[verbaly] check has 1 warning, and the build still passes: run `npx verbaly check` to read them',
    ]);
    warn.mockRestore();
  });
});

describe('runBuildGate: the state file only feeds warnings', () => {
  it('builds past a state file nobody can read, and says once what it cannot report', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = mkdtempSync(join(tmpdir(), 'verbaly-gate-state-'));
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'locales', 'en.json'), '{"a":"A"}');
    writeFileSync(join(root, 'locales', 'es.json'), '{"a":"A es"}');
    writeFileSync(join(root, 'locales', '.verbaly-state.json'), '{broken');
    const cfg = resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
    expect(() => runBuildGate(cfg, new MessageRegistry())).not.toThrow();
    const said = warn.mock.calls.map(([text]) => String(text));
    expect(said.filter((text) => text.includes('outdated translations are not reported'))).toHaveLength(1);
    expect(said[0]).not.toContain('[verbaly] [verbaly]');
    warn.mockRestore();
  });
});
