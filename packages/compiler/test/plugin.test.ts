import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config/config';
import { extractProject } from '../src/scan/extract';
import { stableKey } from '../src/util/key';
import { runBuildGate, transformSource, writeBuildTypes } from '../src/emit/plugin';
import { MessageRegistry } from '../src/scan/registry';

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

describe('transformSource and the project module', () => {
  const rewrite = (code: string, file: string) =>
    transformSource(code, file, new MessageRegistry()).result?.code;

  it('loads verbaly/app where an adapter is imported, so a hook with no provider finds it', () => {
    const code =
      "import { useT } from '@verbaly/react';\nexport const App = () => useT()('home');\n";
    expect(rewrite(code, 'src/App.tsx')).toBe(
      "import 'verbaly/app'; import { useT } from '@verbaly/react';\n" +
        "export const App = () => useT()('home');\n",
    );
  });

  it('keeps every line where it was, so a stack trace still points at the source', () => {
    const code = "// header\nimport { useT } from '@verbaly/vue';\nconst t = useT();\n";
    const out = rewrite(code, 'src/use.ts')!;
    expect(out.split('\n')).toHaveLength(code.split('\n').length);
    expect(out.split('\n')[1]).toBe("import 'verbaly/app'; import { useT } from '@verbaly/vue';");
  });

  it('loads it inside the script block of a Svelte or Vue component', () => {
    const svelte =
      '<script lang="ts">\n  import { useT } from \'@verbaly/svelte\';\n  const t = useT();\n</script>\n\n<p>{$t`Hi`}</p>\n';
    const out = rewrite(svelte, 'src/Hi.svelte')!;
    expect(out).toContain('<script lang="ts">\n  import \'verbaly/app\'; import { useT }');
    expect(out).toContain(`{$t('${stableKey('Hi')}')}`);
    const vue =
      '<script setup lang="ts">\nimport { useT } from \'@verbaly/vue\';\nconst t = useT();\n</script>\n';
    expect(rewrite(vue, 'src/Hi.vue')).toContain(
      "<script setup lang=\"ts\">\nimport 'verbaly/app'; import { useT } from '@verbaly/vue';",
    );
  });

  it("counts Svelte's Trans, which reads the same instance", () => {
    const code = "<script>\n  import Trans from '@verbaly/svelte/Trans.svelte';\n</script>\n";
    expect(rewrite(code, 'src/Rich.svelte')).toContain("import 'verbaly/app'; import Trans");
  });

  it('adds nothing where the file already loads the module, under either name', () => {
    for (const app of ['verbaly/app', 'virtual:verbaly']) {
      const code = `import { useT } from '@verbaly/react';\nimport { locales } from '${app}';\n`;
      expect(rewrite(code, 'src/App.tsx')).toBeUndefined();
    }
  });

  it('adds nothing for an import that only brings types, since it never reaches the browser', () => {
    const typesOnly =
      "import type { TransProps } from '@verbaly/react';\nexport type P = TransProps;\n";
    expect(rewrite(typesOnly, 'src/types.ts')).toBeUndefined();
    const inline =
      "import { type TransProps } from '@verbaly/react';\nexport type P = TransProps;\n";
    expect(rewrite(inline, 'src/types.ts')).toBeUndefined();
    // a type-only import of the module does not load it either
    const typedApp =
      "import { useT } from '@verbaly/react';\nimport type { VerbalyKey } from 'verbaly/app';\n";
    expect(rewrite(typedApp, 'src/App.tsx')).toContain("import 'verbaly/app'; import { useT }");
  });

  it('leaves the core, the server entries and Next alone, where an instance is passed in', () => {
    for (const source of ['verbaly', '@verbaly/react/server', '@verbaly/next/client']) {
      const code = `import { useT } from '${source}';\n`;
      expect(rewrite(code, 'src/app.tsx')).toBeUndefined();
    }
  });
});

describe('transformSource with a build scan', () => {
  function scanned() {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-scan-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    const file = join(root, 'src', 'app.ts');
    const code = 'const s = t`Hola ${name}`;\n';
    writeFileSync(file, code);
    return { cfg: resolveConfig({ root, locales: ['en'] }), file, code };
  }

  // Proved able to fail by parsing in transform anyway: each file was read by Babel twice.
  it('takes the analysis the scan made of a file it read unchanged, once', async () => {
    const { cfg, file, code } = scanned();
    const scan = await extractProject(cfg, { keepSource: true });
    const first = new MessageRegistry();
    transformSource(code, file.replaceAll('/', '\\'), first, scan);
    expect(first.messages().get(KEY)).toBe(scan.messages().get(KEY));
    // handed out once: a second build of the file parses it, so the scan holds nothing for long
    const second = new MessageRegistry();
    transformSource(code, file, second, scan);
    expect(second.messages().get(KEY)).not.toBe(scan.messages().get(KEY));
    expect(second.messages().get(KEY)?.message).toBe('Hola {name}');
  });

  // Proved able to fail by reusing on the path alone: the edited text shipped the scanned one.
  it('parses the code it is handed when it is not what the scan read', async () => {
    const { cfg, file } = scanned();
    const scan = await extractProject(cfg, { keepSource: true });
    const registry = new MessageRegistry();
    const { messages } = transformSource('const s = t`Adiós ${name}`;\n', file, registry, scan);
    expect(Object.values(messages)).toEqual(['Adiós {name}']);
  });

  it('keeps nothing when the scan was not asked to', async () => {
    const { cfg, file, code } = scanned();
    const scan = await extractProject(cfg);
    const registry = new MessageRegistry();
    transformSource(code, file, registry, scan);
    expect(registry.messages().get(KEY)).not.toBe(scan.messages().get(KEY));
  });
});

describe('writeBuildTypes: a build writes the types it ships (0.79.0)', () => {
  function project(): string {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-build-types-'));
    mkdirSync(join(root, 'src'));
    return root;
  }

  it('writes the source catalog it is handed where the host reads types', () => {
    const root = project();
    writeBuildTypes(resolveConfig({ root }), { en: { 'build.greeting': 'Hello' } });
    expect(readFileSync(join(root, 'src', 'verbaly.d.ts'), 'utf8')).toContain('greeting');
  });

  it('warns and lets the build go on when the file cannot be written', () => {
    const root = project();
    // a folder where the file goes: no platform writes a file over it
    mkdirSync(join(root, 'src', 'verbaly.d.ts'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => writeBuildTypes(resolveConfig({ root }), { en: { a: 'A' } })).not.toThrow();
    expect(warn.mock.calls.flat().join('\n')).toContain(
      'could not write the types to src/verbaly.d.ts',
    );
    warn.mockRestore();
  });

  it('lets an error that is not the disk surface', () => {
    const root = project();
    const catalogs = {
      get en(): Record<string, string> {
        throw new TypeError('a bug while reading the catalog');
      },
    };
    expect(() => writeBuildTypes(resolveConfig({ root }), catalogs)).toThrow(TypeError);
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

describe('runBuildGate: an option only the plugin has', () => {
  // the build reads the plugin's sourceLocale and check reads the file's: the two lists differ
  async function split() {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-split-'));
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'verbaly.config.json'), '{"sourceLocale":"en","locales":["en","es"]}');
    writeFileSync(join(root, 'locales', 'en.json'), '{"a":"A"}');
    writeFileSync(join(root, 'locales', 'es.json'), '{"a":"","stray":"Sobra"}');
    const { loadConfig } = await import('../src/config/config');
    return loadConfig(root, { sourceLocale: 'es' }, { plugin: true });
  }

  it('never sends you to a check that reads another config, and names what to move', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      runBuildGate(await split(), new MessageRegistry());
      const said = warn.mock.calls.map(([text]) => String(text));
      const pointers = said.filter((text) => text.includes('npx verbaly check'));
      expect(pointers.length).toBeGreaterThan(0);
      for (const text of pointers) {
        expect(text).toContain('once sourceLocale moves to verbaly.config');
        expect(text).not.toContain('run `npx verbaly check` to read them');
      }
    } finally {
      warn.mockRestore();
    }
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
    // extract writes "" for a new key, so after it the step is filling, which the line leads with
    expect(block).toContain(
      '[verbaly] to fix them:\n  missing: fill the empty translations in your catalogs, or run `npx verbaly translate`',
    );
    expect(block).not.toContain('to scaffold the keys');
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

  // Proved able to fail by leaving collisions out of the report: the build said nothing of dup.
  it('lists a key written with two texts with the broken ones, and stops on it when asked', () => {
    const code = "const a = t.id('dup')`First`;\nconst b = t.id('dup')`Second`;";
    const { cfg, registry } = project({ dup: 'First' }, { dup: 'Primero' }, code);
    const block = printed(() => expect(() => runBuildGate(cfg, registry)).not.toThrow())[0]!;
    expect(block).toContain('✗ the build goes on with 1 key written with more than one text:');
    expect(block).toContain('  dup: one key with 2 texts, and every place shows "First"');
    expect(block).toContain('collisions: give each text its own key');
    expect(() => runBuildGate(cfg, registry, true)).toThrow(/keys written with more than one text/);
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
    writeFileSync(join(root, 'verbaly.lock'), '{broken');
    const cfg = resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
    expect(() => runBuildGate(cfg, new MessageRegistry())).not.toThrow();
    const said = warn.mock.calls.map(([text]) => String(text));
    expect(
      said.filter((text) => text.includes('outdated translations are not reported')),
    ).toHaveLength(1);
    expect(said[0]).not.toContain('[verbaly] [verbaly]');
    warn.mockRestore();
  });
});
