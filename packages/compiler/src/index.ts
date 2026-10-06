// Layer 1: what a project using verbaly touches, its config file and a custom translate provider.
export type {
  BundleConfig,
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

// Layer 2: what builds an integration; the seven first-party packages consume exactly this.
export { loadConfig, resolveConfig, targetLocales } from './config';
// both are public for @verbaly/studio: one broken locale, and old revisions read straight from git
export {
  loadCatalogs,
  needsIcu,
  needsRelative,
  parseCatalog,
  readCatalog,
  writeCatalog,
} from './catalog';
export type { Catalog, Catalogs } from './catalog';
// clientCatalogs is public because @verbaly/next emits the client module without the vite plugin.
export { clientCatalogs } from './bundle';

export { collectOrigins, extractProject, pruneCatalogs, syncCatalogs } from './extract';
export type { SyncResult } from './extract';
export { MessageRegistry } from './registry';
export { stableKey } from './key';

// generateLocaleModule/generateRuntimeModule are the no-virtual-modules path (Turbopack has none).
export { generateDts, generateLocaleModule, generateRuntimeModule, writeDts } from './codegen';
export type { DtsOptions, RuntimeModuleOptions } from './codegen';

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
// both are public because the Next and Vite dev servers say what extract says about a collision
export { collisionEntries, formatCollision } from './check';
export type {
  BrokenEntry,
  CheckResult,
  CollisionEntry,
  DivergentEntry,
  ExtraEntry,
  MissingEntry,
  OutdatedEntry,
  SourceSite,
  UnknownEntry,
} from './check';
// both are public because Studio has to run the same two checks the gate runs before it writes
export { validateMessage, validatePair } from './validate';
// StructureIssue is what those two return, so typed code cannot hold a result without it
export type { IssueSeverity, StructureIssue } from './validate';

export { formatStatusResult, status } from './status';
export type { LocaleStatus, StatusResult } from './status';

export { counted } from './text';
// formatCliError is public so a new entry point prefixes [verbaly] the one documented way
export { formatCliError } from './run';

// clearDrafts is public because @verbaly/studio is where a person approves what a machine wrote.
export { clearDrafts, effectiveDrafts, loadDrafts, markDrafts, saveDrafts } from './drafts';
// the state follows the catalogs wherever they are written: the CLI, the MCP server and dev servers
export { loadState, outdatedTranslations, STATE_FILE, updateState } from './state';
export type { Drafts, Fingerprints, State } from './state';

// mergeTranslations is public because the CLI, the MCP server and Studio all write a finished run
export {
  formatTranslateFailures,
  mergeTranslations,
  resolveProvider,
  translateCatalogs,
  writeDrafts,
} from './translate';
export type { DraftEntry, WriteDraftsResult } from './translate';

// watchTree is public because @verbaly/next watches its dev tree with the same walk the CLI uses
export { watchTree } from './watch';
export type { TreeOptions } from './watch';

export { doctor, formatDoctorEntry } from './doctor';
export { init } from './init';
export type { Host, InitOptions, InitResult } from './init';
export type { DoctorEntry, DoctorResult } from './doctor';

export { wrapProject } from './wrap';
export type { WrapBlocked, WrapEntry, WrapOptions, WrapResult, WrapSkip } from './wrap';

export { formatRenderWarnings, renderSite } from './render';
export type { RenderSiteOptions, RenderSiteResult } from './render';
