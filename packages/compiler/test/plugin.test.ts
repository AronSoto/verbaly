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

describe('runBuildGate: a text never stops the build unless asked (0.70.0)', () => {
  function project(en: Record<string, string>, es: Record<string, string>, code = '') {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-report-'));
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify(en));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify(es));
    const cfg = resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
    const registry = new MessageRegistry();
    if (code) transformSource(code, join(root, 'src', 'app.ts'), registry);
    return { root, cfg, registry };
  }

  function printed(run: () => void): string[] {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      run();
      return warn.mock.calls.map(([text]) => String(text));
    } finally {
      warn.mockRestore();
    }
  }

  // Proved able to fail by throwing again by default: the build stopped on a missing text.
  it('builds on and names what is broken, missing or unknown, the broken first', () => {
    const { cfg, registry } = project(
      { greet: 'Hi {name}', title: 'Title' },
      { greet: 'Hola' },
      "const a = t('nowhere');",
    );
    const said = printed(() => expect(() => runBuildGate(cfg, registry)).not.toThrow());
    expect(said).toHaveLength(1);
    const block = said[0]!;
    const at = (text: string) => block.indexOf(text);
    expect(at('✗ the build goes on with 1 broken translation')).toBeGreaterThan(-1);
    expect(at('  [es] greet:')).toBeGreaterThan(at('✗'));
    expect(at('⚠ the build goes on without 1 translation, shown in en instead:')).toBeGreaterThan(
      at('  [es] greet:'),
    );
    expect(block).toContain('  [es] title: "Title"');
    expect(block).toContain(
      '⚠ the build goes on with 1 key no catalog has, so the key itself shows:',
    );
    expect(block).toContain('  nowhere (used in src/app.ts)');
    expect(block).toContain('[verbaly] to fix them:\n  missing: run `npx verbaly extract`');
    expect(block.split('\n').at(-1)).toBe(
      '[verbaly] `npx verbaly check` lists every one, and in your CI it stops a release on them',
    );
  });

  // Proved able to fail by listing them with the translations: [en] read as shown in en instead.
  it('says a text the source catalog lacks is taken from the code, not a missing translation', () => {
    const { cfg, registry } = project({}, {}, "const a = t.id('home.hello')`Hello`;");
    const block = printed(() => runBuildGate(cfg, registry))[0]!;
    expect(block).toContain(
      '⚠ the build goes on without 1 translation, shown in en instead:\n  [es] home.hello: "Hello"',
    );
    expect(block.split('\n')).toContain(
      '[verbaly] ⚠ the build goes on with 1 text the en catalog does not have yet, taken from the code',
    );
    expect(block).not.toContain('[en]');
  });

  // Proved able to fail by printing every call: a watch said the same block on every rebuild.
  it('says each failure once while it lasts, and again after it went away and came back', () => {
    const { root, cfg, registry } = project({ title: 'Title' }, {});
    expect(printed(() => runBuildGate(cfg, registry))).toHaveLength(1);
    expect(printed(() => runBuildGate(cfg, registry))).toEqual([]);
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ title: 'Título' }));
    expect(printed(() => runBuildGate(cfg, registry))).toEqual([]);
    writeFileSync(join(root, 'locales', 'es.json'), '{}');
    const back = printed(() => runBuildGate(cfg, registry));
    expect(back).toHaveLength(1);
    expect(back[0]).toContain('  [es] title: "Title"');
  });

  // Proved able to fail by keying the memory on the config object: Nuxt printed it twice.
  it('prints a project once when its client and server builds each run the gate', () => {
    const { root, registry } = project({ title: 'Title' }, {});
    const client = resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
    const server = resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
    expect(printed(() => runBuildGate(client, registry))).toHaveLength(1);
    expect(printed(() => runBuildGate(server, registry))).toEqual([]);
  });

  it('shows five of a list and counts the rest, since check is where every one is read', () => {
    const en = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => [k, k]));
    const { cfg, registry } = project(en, {});
    const block = printed(() => runBuildGate(cfg, registry))[0]!;
    expect(block).toContain('without 7 translations');
    expect(block.split('\n').filter((line) => line.startsWith('  [es] '))).toHaveLength(5);
    expect(block).toContain('  and 2 more');
  });

  // Proved able to fail by ignoring the option: a project that asked for the old gate shipped.
  it('stops the build on whatever fails check with failOnMissing: true, as before 0.70.0', () => {
    const missing = project({ title: 'Title' }, {});
    expect(() => runBuildGate(missing.cfg, missing.registry, true)).toThrow(/build blocked/);
    const broken = project({ greet: 'Hi {name}' }, { greet: 'Hola' });
    expect(() => runBuildGate(broken.cfg, broken.registry, true)).toThrow(/broken translations/);
  });

  it('reads failOnMissing: false as the default, so a broken translation is reported too', () => {
    const { cfg, registry } = project({ greet: 'Hi {name}' }, { greet: 'Hola' });
    const said = printed(() => expect(() => runBuildGate(cfg, registry, false)).not.toThrow());
    expect(said[0]).toContain('✗ the build goes on with 1 broken translation');
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
