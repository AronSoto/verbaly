import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableKey } from '@verbaly/compiler';
import { describe, expect, it, vi } from 'vitest';
import verbalyPlugin from '../src/index';

const KEY = stableKey('Hola {name}');
const CODE = 'const s = t`Hola ${name}`;';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// a dev server transforms a file that is on disk, and every write-back re-reads it first
function save(root: string, code: string, path = join(root, 'src', 'app.ts')): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, code);
  return path;
}

function hook<T>(value: unknown): T {
  return (
    typeof value === 'object' && value !== null && 'handler' in value
      ? (value as { handler: unknown }).handler
      : value
  ) as T;
}

function makeProject(locales: Record<string, Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-vite-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  for (const [locale, catalog] of Object.entries(locales)) {
    writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
  }
  return root;
}

async function setup(
  root: string,
  command: 'serve' | 'build',
  options: Parameters<typeof verbalyPlugin>[0] = {},
) {
  const plugin = verbalyPlugin({ sourceLocale: 'es', ...options });
  await hook<(c: unknown) => Promise<void>>(plugin.configResolved)({ root, command });
  return {
    plugin,
    resolveId: hook<(id: string) => string | undefined>(plugin.resolveId),
    load: hook<(id: string) => string | undefined>(plugin.load),
    transform: hook<(code: string, id: string) => { code: string } | null | undefined>(
      plugin.transform,
    ),
    buildEnd: hook<() => void>(plugin.buildEnd),
    configureServer: hook<(server: unknown) => void>(plugin.configureServer),
  };
}

function fakeServer(missingModules: string[] = []) {
  const handlers = new Map<string, ((file: string) => void)[]>();
  const state = { watched: [] as string[], invalidated: [] as string[], reloads: 0 };
  const server = {
    watcher: {
      add: (dir: string) => void state.watched.push(dir),
      on: (event: string, fn: (file: string) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      },
    },
    moduleGraph: {
      getModuleById: (id: string) => (missingModules.includes(id) ? null : { id }),
      invalidateModule: (mod: { id: string }) => void state.invalidated.push(mod.id),
    },
    ws: { send: () => void state.reloads++ },
  };
  const emit = (event: string, file: string) => {
    for (const fn of handlers.get(event) ?? []) fn(file);
  };
  return { server, state, emit };
}

describe('virtual modules', () => {
  it('resolves and loads the runtime module', async () => {
    const root = makeProject({ es: {}, en: {}, pt: {} });
    const { resolveId, load } = await setup(root, 'serve');

    expect(resolveId('virtual:verbaly')).toBe('\0virtual:verbaly');
    const code = load('\0virtual:verbaly');
    expect(code).toContain('createVerbaly');
    expect(code).toContain("import('virtual:verbaly/locale/en')");
    expect(code).toContain("import('virtual:verbaly/locale/pt')");
  });

  it('serves locale catalogs as modules', async () => {
    const root = makeProject({ es: { hola: 'Hola' } });
    const { load } = await setup(root, 'serve');
    expect(load('\0virtual:verbaly/locale/es')).toBe('export default {"hola":"Hola"};\n');
  });
});

describe('dev transform', () => {
  it('never touches files outside the include scope', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'serve');
    expect(transform(CODE, join(root, 'demo', 'app.ts'))).toBeUndefined();
  });

  it('names a file outside include that writes t`…` once, when the server starts', async () => {
    const root = makeProject({ es: {} });
    save(root, CODE, join(root, 'components', 'card.ts'));
    const { plugin, transform } = await setup(root, 'serve');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await hook<() => Promise<void>>(plugin.buildStart)();
    await hook<() => Promise<void>>(plugin.buildStart)();
    // and the file itself is left as written
    expect(transform(CODE, join(root, 'components', 'card.ts'))).toBeUndefined();
    const said = warn.mock.calls
      .flat()
      .filter((line) => String(line).includes('components/card.ts'));
    expect(said).toHaveLength(1);
    warn.mockRestore();
  });

  it('include: [] disables source scanning entirely', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'serve', { include: [] });
    expect(transform(CODE, join(root, 'src', 'app.ts'))).toBeUndefined();
  });

  it('honors a dts path override, creating its directory', async () => {
    const root = makeProject({ es: {} });
    const target = join(root, '.astro', 'integrations', 'verbaly', 'verbaly.d.ts');
    await setup(root, 'serve', { dts: target });
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
  });

  it('dts: false skips type generation', async () => {
    const root = makeProject({ es: {} });
    await setup(root, 'serve', { dts: false });
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
  });

  it('rewrites code and feeds the source catalog', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, load } = await setup(root, 'serve');

    const result = transform(CODE, save(root, CODE));
    expect(result?.code).toBe(`const s = t(${JSON.stringify(KEY)}, { "name": name });`);
    expect(load('\0virtual:verbaly/locale/es')).toContain('Hola {name}');

    await sleep(150);
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'));
    const en = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8'));
    expect(es[KEY]).toBe('Hola {name}');
    expect(en[KEY]).toBe('');
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(true);
  });

  it('skips node_modules and non-source files', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'serve');
    expect(transform(CODE, join(root, 'node_modules', 'x', 'i.ts'))).toBeUndefined();
    expect(transform(CODE, join(root, 'src', 'style.css'))).toBeUndefined();
  });

  it('extracts and rewrites .svelte and .vue components', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, load } = await setup(root, 'serve');

    const svelte = transform('<h1>{$t`Hola ${name}`}</h1>', join(root, 'src', 'App.svelte'));
    expect(svelte?.code).toBe(`<h1>{$t('${KEY}', { 'name': name })}</h1>`);

    const vue = transform(
      '<template><p>{{ t`Hola ${name}` }}</p></template>',
      join(root, 'src', 'App.vue'),
    );
    expect(vue?.code).toBe(`<template><p>{{ t('${KEY}', { 'name': name }) }}</p></template>`);

    expect(load('\0virtual:verbaly/locale/es')).toContain('Hola {name}');
  });
});

describe('dev server', () => {
  it('watches the locales dir and resolves locale subpaths', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, resolveId, load } = await setup(root, 'serve');
    const { server, state } = fakeServer();
    configureServer(server);

    expect(state.watched).toContain(join(root, 'locales'));
    expect(resolveId('virtual:verbaly/locale/en')).toBe('\0virtual:verbaly/locale/en');
    expect(resolveId('src/app.ts')).toBeUndefined();
    expect(load('\0other')).toBeUndefined();
  });

  it('reloads catalogs and invalidates modules on external edits', async () => {
    const root = makeProject({ es: { hola: 'Hola' }, en: { hola: '' } });
    const { configureServer, load } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ hola: 'Hello' }));
    emit('change', join(root, 'locales', 'en.json'));
    await sleep(100);

    expect(load('\0virtual:verbaly/locale/en')).toContain('Hello');
    expect(state.reloads).toBe(1);
    expect(state.invalidated).toContain('\0virtual:verbaly');
    expect(state.invalidated).toContain('\0virtual:verbaly/locale/en');
  });

  it('skips modules missing from the graph', async () => {
    const root = makeProject({ es: {} });
    const { configureServer } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer(['\0virtual:verbaly/locale/es']);
    configureServer(server);

    emit('add', join(root, 'locales', 'es.json'));
    await sleep(100);
    expect(state.reloads).toBe(1);
    expect(state.invalidated).toEqual(['\0virtual:verbaly']);
  });

  it('ignores files outside the locales dir and non-json files', async () => {
    const root = makeProject({ es: {} });
    const { configureServer } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    emit('change', join(root, 'other.json'));
    emit('change', join(root, 'locales', 'notes.txt'));
    await sleep(100);
    expect(state.reloads).toBe(0);
  });

  // Proved able to fail without the dotfile check: review --approve reloaded every open tab.
  it('ignores the drafts sidecar, which sits next to the catalogs and renders nothing', async () => {
    const root = makeProject({ es: {} });
    const { configureServer } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    emit('change', join(root, 'locales', '.verbaly-drafts.json'));
    await sleep(100);
    expect(state.reloads).toBe(0);
  });

  it('dedupes its own catalog writes but not external edits', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    transform(CODE, save(root, CODE));
    await sleep(150); // flush wrote catalogs + reloaded once
    expect(state.reloads).toBe(1);

    // watcher echo of the self-write: same content, no reload
    emit('change', join(root, 'locales', 'es.json'));
    await sleep(100);
    expect(state.reloads).toBe(1);

    // real external edit afterwards reloads
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ [KEY]: 'Hello {name}' }));
    emit('change', join(root, 'locales', 'en.json'));
    await sleep(100);
    expect(state.reloads).toBe(2);
  });

  it('reloads when its self-written catalog is gone from disk', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    transform(CODE, save(root, CODE));
    await sleep(150); // records the self-write and writes es.json
    expect(state.reloads).toBe(1);

    // the file the plugin just wrote is removed: safeRead throws, so the echo is not swallowed
    rmSync(join(root, 'locales', 'es.json'));
    emit('change', join(root, 'locales', 'es.json'));
    await sleep(100);
    expect(state.reloads).toBe(2);
  });

  it('reloads when a stale self-write entry hides an external edit', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    transform(CODE, save(root, CODE));
    await sleep(150);
    expect(state.reloads).toBe(1);

    // disk now differs from the recorded self-write → must reload
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ [KEY]: 'Hola editado' }));
    emit('change', join(root, 'locales', 'es.json'));
    await sleep(100);
    expect(state.reloads).toBe(2);
  });

  it('drops messages of unlinked source files and ignores node_modules', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    const file = join(root, 'src', 'app.ts');
    transform(CODE, file);
    await sleep(150);
    expect(state.reloads).toBe(1);

    emit('unlink', join(root, 'node_modules', 'x', 'i.ts'));
    emit('unlink', join(root, 'locales', 'es.json')); // not a source file
    await sleep(100);
    expect(state.reloads).toBe(1);

    emit('unlink', file);
    await sleep(150);
    expect(state.reloads).toBe(2);
  });

  it('transform skips virtual ids', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'serve');
    expect(transform(CODE, '\0virtual.ts')).toBeUndefined();
  });
});

describe('build check', () => {
  it('blocks the build on missing translations', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, buildEnd } = await setup(root, 'build');
    transform(CODE, save(root, CODE));
    expect(() => buildEnd()).toThrowError(/missing translations/);
  });

  it('passes when catalogs are complete', async () => {
    const root = makeProject({
      es: { [KEY]: 'Hola {name}' },
      en: { [KEY]: 'Hello {name}' },
    });
    const { transform, buildEnd } = await setup(root, 'build');
    transform(CODE, save(root, CODE));
    expect(() => buildEnd()).not.toThrow();
  });

  it('blocks the build on unknown keys', async () => {
    const root = makeProject({ es: { [KEY]: 'Hola {name}' }, en: { [KEY]: 'Hello {name}' } });
    const { transform, buildEnd } = await setup(root, 'build');
    transform("const s = t('nope.missing');", join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).toThrowError(/build blocked/);
  });

  it('failOnMissing: false waives untranslated strings', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, buildEnd } = await setup(root, 'build', { failOnMissing: false });
    transform(CODE, save(root, CODE));
    expect(() => buildEnd()).not.toThrow();
  });

  it('failOnMissing: false still blocks a broken translation', async () => {
    // opting out is about untranslated strings: a missing one falls back, a broken one does not
    const root = makeProject({ es: { [KEY]: 'Hola {name}' }, en: { [KEY]: 'Hello' } });
    const { transform, buildEnd } = await setup(root, 'build', { failOnMissing: false });
    transform(CODE, save(root, CODE));
    expect(() => buildEnd()).toThrowError(/broken translations/);
  });

  it('names the remedy that matches the failure', async () => {
    const root = makeProject({ es: { [KEY]: 'Hola {name}' }, en: { [KEY]: 'Hello' } });
    const { transform, buildEnd } = await setup(root, 'build');
    transform(CODE, save(root, CODE));
    // a broken translation is not repaired by extract, which is all it used to say
    expect(() => buildEnd()).toThrowError(/params, tags and plural cases/);
  });

  it('does not write catalogs during build', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'build');
    transform(CODE, save(root, CODE));
    await sleep(150);
    expect(JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'))).toEqual({});
  });
});

describe('dev writes back from the disk (0.68.0)', () => {
  // Proved able to fail by syncing against the registry as it was: the old text came back.
  it('never writes back a text the code on disk no longer has, after a checkout', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, emit } = fakeServer();
    configureServer(server);
    transform("const s = t.id('home')`Hola`;", save(root, "const s = t.id('home')`Hola`;"));
    await sleep(150);
    // a checkout moves the code and the catalog together, and the module is not loaded again
    save(root, "const s = t.id('home')`Bienvenido`;");
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ home: 'Bienvenido' }));
    emit('change', join(root, 'locales', 'es.json'));
    await sleep(150);
    expect(JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'))).toEqual({
      home: 'Bienvenido',
    });
  });

  // Proved able to fail by letting the rejection escape: a half-typed catalog ended the process.
  it('survives a catalog saved with broken JSON, and says why', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer } = await setup(root, 'serve');
    const { server, emit } = fakeServer();
    configureServer(server);
    const warned: string[] = [];
    const original = console.warn;
    console.warn = (line: unknown) => void warned.push(String(line));
    try {
      writeFileSync(join(root, 'locales', 'es.json'), '{ "home": ');
      emit('change', join(root, 'locales', 'es.json'));
      await sleep(150);
    } finally {
      console.warn = original;
    }
    expect(warned.some((line) => line.includes('es.json is not valid JSON'))).toBe(true);
  });

  // Proved able to fail by keeping a text vite saw before: two plugins overwrote each other.
  it('two plugin instances on one catalog settle instead of overwriting each other', async () => {
    const root = makeProject({ es: {}, en: {} });
    const first = await setup(root, 'serve');
    const second = await setup(root, 'serve');
    const a = fakeServer();
    const b = fakeServer();
    first.configureServer(a.server);
    second.configureServer(b.server);
    first.transform("const s = t.id('home')`Viejo`;", save(root, "const s = t.id('home')`Viejo`;"));
    await sleep(150);
    // the second instance loads the module after it changed on disk
    second.transform(
      "const s = t.id('home')`Nuevo`;",
      save(root, "const s = t.id('home')`Nuevo`;"),
    );
    await sleep(150);
    for (let round = 0; round < 3; round += 1) {
      a.emit('change', join(root, 'locales', 'es.json'));
      b.emit('change', join(root, 'locales', 'es.json'));
      await sleep(120);
    }
    expect(JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'))).toEqual({
      home: 'Nuevo',
    });
    const writes = a.state.reloads + b.state.reloads;
    expect(writes).toBeLessThan(8);
  });

  it('says an outdated translation in dev, like next dev', async () => {
    const root = makeProject({ es: { bio: 'Escribo software' }, en: { bio: 'I write code' } });
    writeFileSync(
      join(root, 'locales', '.verbaly-state.json'),
      JSON.stringify({
        fingerprints: {
          en: { bio: `${stableKey('Escribo código')}.${stableKey('I write code')}` },
        },
      }),
    );
    const { configureServer, transform } = await setup(root, 'serve');
    const { server } = fakeServer();
    configureServer(server);
    const warned: string[] = [];
    const original = console.warn;
    console.warn = (line: unknown) => void warned.push(String(line));
    try {
      transform("const s = t('bio');", save(root, "const s = t('bio');"));
      transform(CODE, save(root, CODE, join(root, 'src', 'other.ts')));
      await sleep(150);
    } finally {
      console.warn = original;
    }
    expect(warned).toContain(
      '[verbaly] [en] bio: translated from an older source text, update it or keep it with `npx verbaly review --approve`',
    );
  });
});

describe('the code owns the texts it writes, in build and in dev (0.67.0)', () => {
  it('a build emits the text in the code, not a catalog edit of it', async () => {
    const root = makeProject({ es: { greet: 'Editado a mano' }, en: { greet: 'Hello' } });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), "export const s = t.id('greet')`Hola`;\n");
    const { plugin, load } = await setup(root, 'build');
    await hook<() => Promise<void>>(plugin.buildStart)();
    expect(load('\0virtual:verbaly/locale/es')).toBe('export default {"greet":"Hola"};\n');
    // the author's file stays as it was: a build never writes a catalog
    expect(readFileSync(join(root, 'locales', 'es.json'), 'utf8')).toContain('Editado a mano');
  });

  it('dev puts the code text back over a hand edit of it, and says where it lives', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);
    const warned: string[] = [];
    const original = console.warn;
    console.warn = (line: unknown) => void warned.push(String(line));
    try {
      // its own key: the dedupe is per process, and an earlier test already replaced KEY
      transform(
        "const s = t.id('owned')`Hola tuyo`;",
        save(root, "const s = t.id('owned')`Hola tuyo`;"),
      );
      await sleep(150);
      writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ owned: 'Hola editado' }));
      emit('change', join(root, 'locales', 'es.json'));
      await sleep(100);
    } finally {
      console.warn = original;
    }
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as object;
    expect(es).toEqual({ owned: 'Hola tuyo' });
    expect(warned.some((line) => line.includes('your edit of "owned" was replaced'))).toBe(true);
    expect(state.reloads).toBe(2);
  });
});
