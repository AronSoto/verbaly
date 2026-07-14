import {
  MessageRegistry,
  RESOLVED_VIRTUAL_ID,
  analyzeFile,
  isTransformTarget,
  loadCatalogs,
  loadConfig,
  loadVirtualModule,
  resolveVirtualId,
  runBuildGate,
  transformCode,
  type Catalogs,
  type ResolvedConfig,
  type VerbalyConfig,
} from '@verbaly/compiler';
import { createUnplugin, type UnpluginFactory, type UnpluginInstance } from 'unplugin';

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
      return resolveVirtualId(id) ?? null;
    },

    loadInclude(id) {
      return id.startsWith(RESOLVED_VIRTUAL_ID);
    },

    load(id) {
      return loadVirtualModule(id, cfg, catalogs) ?? null;
    },

    transformInclude(id) {
      return isTransformTarget(id);
    },

    transform(code, id) {
      const analysis = analyzeFile(code, id);
      registry.update(id, analysis);
      return transformCode(code, id, analysis) ?? null;
    },

    buildEnd() {
      if (options.failOnMissing === false) return;
      runBuildGate(cfg, registry);
    },
  };
};

export const verbaly: UnpluginInstance<UnpluginVerbalyOptions | undefined> =
  createUnplugin(factory);

export default verbaly;

export type { VerbalyConfig } from '@verbaly/compiler';
