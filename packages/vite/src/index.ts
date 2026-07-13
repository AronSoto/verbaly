import {
  LOCALE_MODULE_PREFIX,
  MessageRegistry,
  RESOLVED_VIRTUAL_ID,
  SOURCE_FILE_RE,
  analyze,
  isTransformTarget,
  loadCatalogs,
  loadConfig,
  loadVirtualModule,
  resolveVirtualId,
  runBuildGate,
  syncCatalogs,
  transformCode,
  writeCatalog,
  writeDts,
  type Catalogs,
  type ResolvedConfig,
  type VerbalyConfig,
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

export interface ViteVerbalyOptions extends VerbalyConfig {
  // opt out of the build gate (parity with @verbaly/unplugin)
  failOnMissing?: boolean;
}

export default function verbaly(options: ViteVerbalyOptions = {}): Plugin {
  let cfg: ResolvedConfig;
  let catalogs: Catalogs;
  let isBuild = false;
  let server: ViteDevServer | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
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

  function flushCatalogs(): void {
    syncCatalogs(cfg, catalogs, registry);
    for (const locale of cfg.locales) {
      const serialized = writeCatalog(cfg, locale, catalogs[locale] ?? {});
      selfWrites.set(locale, serialized);
    }
    writeDts(cfg, new Map(Object.entries(catalogs[cfg.sourceLocale] ?? {})));
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
      if (!isBuild) {
        writeDts(cfg, new Map(Object.entries(catalogs[cfg.sourceLocale] ?? {})));
      }
    },

    configureServer(devServer) {
      server = devServer;
      devServer.watcher.add(cfg.dir);
      const onCatalogFile = (file: string, locale?: string): void => {
        if (!file.startsWith(cfg.dir) || !file.endsWith('.json')) return;
        if (locale) {
          const expected = selfWrites.get(locale);
          if (expected !== undefined) {
            selfWrites.delete(locale);
            // content compare: a stale entry must not swallow an external edit
            if (safeRead(file) === expected) return;
          }
        }
        void reloadFromDisk();
      };
      const localeOf = (file: string): string | undefined =>
        file.split(/[\\/]/).pop()?.slice(0, -5);
      devServer.watcher.on('change', (file) => onCatalogFile(file, localeOf(file)));
      devServer.watcher.on('add', (file) => onCatalogFile(file, localeOf(file)));
      devServer.watcher.on('unlink', (file) => {
        if (SOURCE_FILE_RE.test(file) && !file.includes('node_modules')) {
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
      if (!isTransformTarget(id)) return undefined;
      const analysis = analyze(code, id);
      registry.update(id, analysis);

      if (!isBuild && analysis.tagged.length > 0) {
        const source = (catalogs[cfg.sourceLocale] ??= {});
        let changed = false;
        for (const msg of analysis.tagged) {
          if (source[msg.key] !== msg.message) {
            source[msg.key] = msg.message;
            changed = true;
          }
        }
        if (changed) scheduleFlush();
      }

      return transformCode(code, id, analysis) ?? undefined;
    },

    buildEnd() {
      if (!isBuild || options.failOnMissing === false) return;
      runBuildGate(cfg, registry);
    },
  };
}
