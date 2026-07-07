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
  transformCode,
  type Catalogs,
  type ResolvedConfig,
  type VerbalyConfig,
} from '@verbaly/compiler';
import { createUnplugin, type UnpluginFactory, type UnpluginInstance } from 'unplugin';

const RESOLVED = '\0' + VIRTUAL_ID;
const LOCALE_PREFIX = `${RESOLVED}/locale/`;
const SOURCE_RE = /\.[cm]?[jt]sx?$/;

export interface UnpluginVerbalyOptions extends VerbalyConfig {
  failOnMissing?: boolean;
}

// build-focused: virtual modules + transform + gate.
const factory: UnpluginFactory<UnpluginVerbalyOptions | undefined> = (options = {}) => {
  let cfg: ResolvedConfig;
  let catalogs: Catalogs;
  const registry = new MessageRegistry();
  const ready = (async () => {
    cfg = await loadConfig(options.root ?? process.cwd(), options);
    catalogs = loadCatalogs(cfg);
  })();

  return {
    name: 'verbaly',
    enforce: 'pre',

    async buildStart() {
      await ready;
    },

    resolveId(id) {
      if (id === VIRTUAL_ID || id.startsWith(`${VIRTUAL_ID}/`)) return '\0' + id;
      return null;
    },

    loadInclude(id) {
      return id.startsWith(RESOLVED);
    },

    load(id) {
      if (id === RESOLVED) return generateRuntimeModule(cfg);
      if (id.startsWith(LOCALE_PREFIX)) {
        return generateLocaleModule(catalogs[id.slice(LOCALE_PREFIX.length)] ?? {});
      }
      return null;
    },

    transformInclude(id) {
      return SOURCE_RE.test(id) && !id.includes('node_modules') && !id.startsWith('\0');
    },

    transform(code, id) {
      const analysis = analyze(code, id);
      registry.update(id, analysis);
      return transformCode(code, id, analysis) ?? null;
    },

    buildEnd() {
      if (options.failOnMissing === false) return;
      const result = check(cfg, loadCatalogs(cfg), registry);
      if (!result.ok) {
        throw new Error(
          `[verbaly] build blocked\n${formatCheckResult(result)}\n` +
            `Run \`npx verbaly extract\` and fill the missing translations.`,
        );
      }
    },
  };
};

export const verbaly: UnpluginInstance<UnpluginVerbalyOptions | undefined> =
  createUnplugin(factory);

export default verbaly;

export type { VerbalyConfig } from '@verbaly/compiler';
