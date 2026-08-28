// Layer 1: what a project using verbaly touches, its config file and a custom translate provider.
export type {
  GlossaryEntry,
  RedirectConfig,
  RenderConfig,
  ResolvedConfig,
  TranslateConfig,
  VerbalyConfig,
} from './config';
export type {
  TranslateFailure,
  TranslateOptions,
  TranslateProgress,
  TranslateProvider,
  TranslateRequest,
  TranslateResult,
} from './translate';

// Layer 2: what builds an integration; the six first-party packages consume exactly this.
export { loadConfig, resolveConfig } from './config';
export { loadCatalogs, needsIcu, needsRelative, writeCatalog } from './catalog';
export type { Catalog, Catalogs } from './catalog';

export { collectOrigins, extractProject, pruneCatalogs, syncCatalogs } from './extract';
export type { SyncResult } from './extract';
export { MessageRegistry } from './registry';
export { stableKey } from './key';

// generateLocaleModule/generateRuntimeModule are the no-virtual-modules path (Turbopack has none).
export { generateDts, generateLocaleModule, generateRuntimeModule, writeDts } from './codegen';
export type { RuntimeModuleOptions } from './codegen';

export {
  LOCALE_MODULE_PREFIX,
  RESOLVED_VIRTUAL_ID,
  SOURCE_FILE_RE,
  createSourceFilter,
  isTransformTarget,
  loadVirtualModule,
  resolveVirtualId,
  runBuildGate,
  transformSource,
} from './plugin';
export type { PluginOptions } from './plugin';
export { transformCode } from './transform';
export type { TransformResult } from './transform';

export { check, formatCheckResult, formatCheckWarnings } from './check';
export type { BrokenEntry, CheckResult, MissingEntry, UnknownEntry } from './check';
export type { IssueSeverity } from './validate';

export { formatStatusResult, status } from './status';
export type { LocaleStatus, StatusResult } from './status';

export { counted } from './text';

export { effectiveDrafts, loadDrafts, markDrafts, saveDrafts } from './drafts';
export type { Drafts } from './drafts';

export { formatTranslateFailures, resolveProvider, translateCatalogs } from './translate';

export { doctor, formatDoctorEntry } from './doctor';
export type { DoctorEntry, DoctorResult } from './doctor';

export { wrapProject } from './wrap';
export type { WrapEntry, WrapOptions, WrapResult, WrapSkip } from './wrap';

export { formatRenderWarnings, renderSite } from './render';
export type { RenderSiteOptions, RenderSiteResult } from './render';
