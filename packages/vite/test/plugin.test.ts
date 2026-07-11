import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableKey } from '@verbaly/compiler';
import { describe, expect, it } from 'vitest';
import verbalyPlugin from '../src/index';

const KEY = stableKey('Hola {name}');
const CODE = 'const s = t`Hola ${name}`;';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  it('rewrites code and feeds the source catalog', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, load } = await setup(root, 'serve');

    const result = transform(CODE, join(root, 'src', 'app.ts'));
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

  it('dedupes its own catalog writes but not external edits', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    transform(CODE, join(root, 'src', 'app.ts'));
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

  it('reloads when a stale self-write entry hides an external edit', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { configureServer, transform } = await setup(root, 'serve');
    const { server, state, emit } = fakeServer();
    configureServer(server);

    transform(CODE, join(root, 'src', 'app.ts'));
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
    transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).toThrowError(/missing translations/);
  });

  it('passes when catalogs are complete', async () => {
    const root = makeProject({
      es: { [KEY]: 'Hola {name}' },
      en: { [KEY]: 'Hello {name}' },
    });
    const { transform, buildEnd } = await setup(root, 'build');
    transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).not.toThrow();
  });

  it('blocks the build on unknown keys', async () => {
    const root = makeProject({ es: { [KEY]: 'Hola {name}' }, en: { [KEY]: 'Hello {name}' } });
    const { transform, buildEnd } = await setup(root, 'build');
    transform("const s = t('nope.missing');", join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).toThrowError(/build blocked/);
  });

  it('failOnMissing: false opts out of the gate', async () => {
    const root = makeProject({ es: {}, en: {} });
    const { transform, buildEnd } = await setup(root, 'build', { failOnMissing: false });
    transform(CODE, join(root, 'src', 'app.ts'));
    expect(() => buildEnd()).not.toThrow();
  });

  it('does not write catalogs during build', async () => {
    const root = makeProject({ es: {} });
    const { transform } = await setup(root, 'build');
    transform(CODE, join(root, 'src', 'app.ts'));
    await sleep(150);
    expect(JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8'))).toEqual({});
  });
});
