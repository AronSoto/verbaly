import {
  MessageRegistry,
  RESOLVED_VIRTUAL_ID,
  createSourceFilter,
  extractProject,
  isTransformTarget,
  loadCatalogs,
  loadConfig,
  loadVirtualModule,
  reportOutsideInclude,
  resolveVirtualId,
  runBuildGate,
  syncCatalogs,
  transformSource,
  type Catalogs,
  type PluginOptions,
  type ResolvedConfig,
} from '@verbaly/compiler';
import { createUnplugin, type UnpluginFactory, type UnpluginInstance } from 'unplugin';

// the shared bundler-plugin options (config + failOnMissing), named for this plugin
export type UnpluginVerbalyOptions = PluginOptions;

// build-focused: virtual modules + transform + gate.
const factory: UnpluginFactory<UnpluginVerbalyOptions | undefined> = (options = {}) => {
  let cfg: ResolvedConfig;
  let catalogs: Catalogs;
  let included: (id: string) => boolean;
  const registry = new MessageRegistry();
  const ready = (async () => {
    cfg = await loadConfig(options.root ?? process.cwd(), options);
    catalogs = loadCatalogs(cfg);
    included = createSourceFilter(cfg);
    // the code's text ships: a text it owns that was edited in the catalog never reaches the bundle
    syncCatalogs(cfg, catalogs, await extractProject(cfg));
  })();
  // buildStart awaits it and reports the failure; unwatched till then, a rejection ends the process
  ready.catch(() => {});

  return {
    name: 'verbaly',
    enforce: 'pre',

    async buildStart() {
      await ready;
      // a file outside include writes a t`…` that no build translates: said once, at the start
      await reportOutsideInclude(cfg);
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
      if (!included(id)) return null;
      return transformSource(code, id, registry).result;
    },

    buildEnd() {
      runBuildGate(cfg, registry, options.failOnMissing);
    },
  };
};

export const verbaly: UnpluginInstance<UnpluginVerbalyOptions | undefined> =
  createUnplugin(factory);

export default verbaly;

export type { VerbalyConfig } from '@verbaly/compiler';
