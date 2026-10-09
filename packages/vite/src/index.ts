import {
  LOCALE_MODULE_PREFIX,
  MessageRegistry,
  RESOLVED_VIRTUAL_ID,
  createDevReporter,
  createSourceFilter,
  extractProject,
  formatCliError,
  reportOutsideInclude,
  isTransformTarget,
  loadCatalogs,
  loadConfig,
  loadVirtualModule,
  outdatedTranslations,
  resolveVirtualId,
  runBuildGate,
  syncCatalogs,
  syncProject,
  transformSource,
  writeDts,
  type Catalogs,
  type DevReporter,
  type Finding,
  type PluginOptions,
  type ResolvedConfig,
  type SyncProjectResult,
} from '@verbaly/compiler';
import { readFileSync } from 'node:fs';
import type { Plugin, ViteDevServer } from 'vite';

function safeRead(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

export type { VerbalyConfig } from '@verbaly/compiler';
export type ViteVerbalyOptions = PluginOptions;

export default function verbaly(options: ViteVerbalyOptions = {}): Plugin {
  let cfg: ResolvedConfig;
  let catalogs: Catalogs;
  let isBuild = false;
  let server: ViteDevServer | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let included: (id: string) => boolean;
  let reporter: DevReporter | undefined;
  let stateBroken = false;
  // one write-back at a time: a save and a catalog edit landing together must not interleave
  let writing: Promise<void> = Promise.resolve();
  const registry = new MessageRegistry();
  const selfWrites = new Map<string, string>();

  function invalidateVirtual(): void {
    if (!server) return;
    const ids = [
      RESOLVED_VIRTUAL_ID,
      ...cfg.locales.map((locale) => LOCALE_MODULE_PREFIX + locale),
    ];
    for (const id of ids) {
      const mod = server.moduleGraph.getModuleById(id);
      if (mod) server.moduleGraph.invalidateModule(mod);
    }
    server.ws.send({ type: 'full-reload' });
  }

  // cfg.dts is the merged option: @verbaly/astro fills its override before Vite resolves config
  function flushDts(): void {
    writeDts(cfg, catalogs[cfg.sourceLocale] ?? {});
  }

  // what the dev server says, through the same reporter and wording as next dev
  function report(result: SyncProjectResult, catalogEdit: boolean): void {
    reporter ??= createDevReporter(cfg.root);
    const replaced: Finding[] = [];
    const code: Finding[] = [];
    for (const finding of result.findings) {
      if (finding.kind === 'collision' || finding.kind === 'renamed') code.push(finding);
      // a change to the catalog that the code undid was a person's edit; one to the code is not
      else if (finding.kind === 'replaced' && catalogEdit)
        replaced.push({ ...finding, edited: true });
    }
    reporter.report('replaced', replaced);
    reporter.report('code', code);
    const outdated = result.state
      ? outdatedTranslations(cfg, result.catalogs, result.state.fingerprints)
      : [];
    reporter.report(
      'outdated',
      outdated.map((entry): Finding => ({ kind: 'outdated', ...entry })),
    );
    if (result.stateProblem && !stateBroken) {
      console.warn(`[verbaly] ${result.stateProblem}, so drafts are not tracked`);
    }
    stateBroken = Boolean(result.stateProblem);
  }

  // every write in dev starts from the disk, and re-reads the files behind each text that changes
  async function writeBack(catalogEdit: boolean): Promise<void> {
    if (catalogEdit) cfg = await loadConfig(cfg.root, options);
    const result = await syncProject(cfg, {
      registry,
      catalogs: loadCatalogs(cfg),
      confirm: true,
      write: 'changed',
    });
    catalogs = result.catalogs;
    for (const [locale, serialized] of Object.entries(result.written)) {
      selfWrites.set(locale, serialized);
    }
    report(result, catalogEdit);
    invalidateVirtual();
  }

  function queueWriteBack(catalogEdit: boolean): void {
    // a catalog saved half-typed is broken JSON for a moment, and that must never end the server
    writing = writing
      .then(() => writeBack(catalogEdit))
      .catch((error: unknown) => console.warn(formatCliError(error)));
  }

  function scheduleFlush(): void {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => queueWriteBack(false), 50);
  }

  return {
    name: 'verbaly',
    enforce: 'pre',

    async configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
      cfg = await loadConfig(options.root ?? viteConfig.root, options);
      catalogs = loadCatalogs(cfg);
      included = createSourceFilter(cfg);
      if (!isBuild) {
        flushDts();
      }
    },

    configureServer(devServer) {
      server = devServer;
      devServer.watcher.add(cfg.dir);
      const onCatalogFile = (file: string): void => {
        if (!file.startsWith(cfg.dir) || !file.endsWith('.json')) return;
        const locale = file.split(/[\\/]/).pop()!.slice(0, -5);
        // a dotfile there is the state sidecar: it changes no message, so no tab has to reload
        if (locale.startsWith('.')) return;
        const expected = selfWrites.get(locale);
        if (expected !== undefined) {
          selfWrites.delete(locale);
          // content compare: a stale entry must not swallow an external edit
          if (safeRead(file) === expected) return;
        }
        queueWriteBack(true);
      };
      devServer.watcher.on('change', onCatalogFile);
      devServer.watcher.on('add', onCatalogFile);
      devServer.watcher.on('unlink', (file) => {
        if (isTransformTarget(file) && included(file)) {
          registry.remove(file);
          scheduleFlush();
        }
      });
    },

    // the code's text ships, as in dev: the whole scan runs before any module is emitted
    async buildStart() {
      // dev and build alike: a file outside include writes a t`…` that no build translates
      await reportOutsideInclude(cfg);
      if (!isBuild) return;
      syncCatalogs(cfg, catalogs, await extractProject(cfg));
    },

    resolveId(id) {
      return resolveVirtualId(id);
    },

    load(id) {
      return loadVirtualModule(id, cfg, catalogs);
    },

    transform(code, id) {
      if (!isTransformTarget(id) || !included(id)) return undefined;
      const { messages, result } = transformSource(code, id, registry);

      const found = Object.entries(messages);
      if (!isBuild && found.length > 0) {
        const source = (catalogs[cfg.sourceLocale] ??= {});
        let changed = false;
        for (const [key, message] of found) {
          if (source[key] !== message) {
            source[key] = message;
            changed = true;
          }
        }
        if (changed) scheduleFlush();
      }

      return result ?? undefined;
    },

    buildEnd() {
      if (!isBuild) return;
      runBuildGate(cfg, registry, options.failOnMissing);
    },
  };
}
