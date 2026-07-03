import {
  MessageRegistry,
  VIRTUAL_ID,
  analyze,
  check,
  formatCheckResult,
  generateLocaleModule,
  generateRuntimeModule,
  loadCatalogs,
  loadConfig,
  syncCatalogs,
  transformCode,
  writeCatalog,
  writeDts,
  type Catalogs,
  type ResolvedConfig,
  type VerbalyConfig,
} from '@verbaly/compiler';
import type { Plugin, ViteDevServer } from 'vite';

const RESOLVED = '\0' + VIRTUAL_ID;
const LOCALE_PREFIX = `${RESOLVED}/locale/`;
const SOURCE_RE = /\.[cm]?[jt]sx?$/;

export type { VerbalyConfig } from '@verbaly/compiler';

export default function verbaly(options: VerbalyConfig = {}): Plugin {
  let cfg: ResolvedConfig;
  let catalogs: Catalogs;
  let isBuild = false;
  let server: ViteDevServer | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  const registry = new MessageRegistry();
  const selfWrites = new Map<string, string>();

  function invalidateVirtual(): void {
    if (!server) return;
    const ids = [RESOLVED, ...cfg.locales.map((locale) => LOCALE_PREFIX + locale)];
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
        if (locale && selfWrites.get(locale) !== undefined) {
          selfWrites.delete(locale);
          return;
        }
        void reloadFromDisk();
      };
      devServer.watcher.on('change', (file) =>
        onCatalogFile(file, file.split(/[\\/]/).pop()?.slice(0, -5)),
      );
      devServer.watcher.on('add', (file) => onCatalogFile(file));
      devServer.watcher.on('unlink', (file) => {
        if (SOURCE_RE.test(file) && !file.includes('node_modules')) {
          registry.remove(file);
          scheduleFlush();
        }
      });
    },

    resolveId(id) {
      if (id === VIRTUAL_ID || id.startsWith(`${VIRTUAL_ID}/`)) return '\0' + id;
      return undefined;
    },

    load(id) {
      if (id === RESOLVED) return generateRuntimeModule(cfg);
      if (id.startsWith(LOCALE_PREFIX)) {
        return generateLocaleModule(catalogs[id.slice(LOCALE_PREFIX.length)] ?? {});
      }
      return undefined;
    },

    transform(code, id) {
      if (!SOURCE_RE.test(id) || id.includes('node_modules') || id.startsWith('\0')) {
        return undefined;
      }
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
      if (!isBuild) return;
      const result = check(cfg, loadCatalogs(cfg), registry);
      if (!result.ok) {
        throw new Error(
          `[verbaly] build blocked\n${formatCheckResult(result)}\n` +
            `Run \`npx verbaly extract\` and fill the missing translations.`,
        );
      }
    },
  };
}
