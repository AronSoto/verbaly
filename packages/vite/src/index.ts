import {
  LOCALE_MODULE_PREFIX,
  MessageRegistry,
  RESOLVED_VIRTUAL_ID,
  createSourceFilter,
  isTransformTarget,
  loadCatalogs,
  loadConfig,
  loadVirtualModule,
  resolveVirtualId,
  runBuildGate,
  syncCatalogs,
  transformSource,
  writeCatalog,
  writeDts,
  type Catalogs,
  type PluginOptions,
  type ResolvedConfig,
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
    if (cfg.dts === false) return;
    writeDts(cfg, catalogs[cfg.sourceLocale] ?? {}, cfg.dts);
  }

  function flushCatalogs(): void {
    syncCatalogs(cfg, catalogs, registry);
    for (const locale of cfg.locales) {
      const serialized = writeCatalog(cfg, locale, catalogs[locale] ?? {});
      selfWrites.set(locale, serialized);
    }
    flushDts();
    invalidateVirtual();
  }

  function scheduleFlush(): void {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushCatalogs, 50);
  }

  async function reloadFromDisk(): Promise<void> {
    cfg = await loadConfig(cfg.root, options);
    catalogs = loadCatalogs(cfg);
    invalidateVirtual();
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
        const expected = selfWrites.get(locale);
        if (expected !== undefined) {
          selfWrites.delete(locale);
          // content compare: a stale entry must not swallow an external edit
          if (safeRead(file) === expected) return;
        }
        void reloadFromDisk();
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
