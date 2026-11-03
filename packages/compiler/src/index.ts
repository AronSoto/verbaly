// Layer 1: what a project using verbaly touches, its config file and a custom translate provider.
export type {
  BundleConfig,
  GlossaryEntry,
  RedirectConfig,
  RenderConfig,
  ResolvedConfig,
  TranslateConfig,
  VerbalyConfig,
} from './config/config';
export type {
  TranslateFailure,
  TranslateOptions,
  TranslateProgress,
  TranslateProvider,
  TranslateRequest,
  TranslateResult,
} from './exchange/translate';

// Layer 2: what builds an integration; the seven first-party packages consume exactly this.
export { loadConfig, resolveConfig, targetLocales } from './config/config';
// both are public for @verbaly/studio: one broken locale, and old revisions read straight from git
export {
  loadCatalogs,
  needsIcu,
  needsRelative,
  parseCatalog,
  readCatalog,
  writeCatalog,
} from './catalog/catalog';
export type { Catalog, Catalogs } from './catalog/catalog';
// clientCatalogs is public because @verbaly/next emits the client module without the vite plugin.
export { clientCatalogs } from './emit/bundle';

export { collectOrigins, extractProject, pruneCatalogs, syncCatalogs } from './scan/extract';
export type { SyncResult } from './scan/extract';
// shippedCatalogs is public because Studio and the MCP server read the text a build ships
export { shippedCatalogs } from './scan/extract';
// the one path from the code to the catalogs: the CLI, the MCP server, Studio and next dev
export { syncProject } from './project/project';
export type { SyncProjectResult } from './project/project';
export { MessageRegistry } from './scan/registry';
export { stableKey } from './util/key';

// generateLocaleModule/generateRuntimeModule are the no-virtual-modules path (Turbopack has none).
export { generateDts, generateLocaleModule, generateRuntimeModule, writeDts } from './emit/codegen';
// the import the docs teach for the project's module; bundler hosts match it before resolving
export { APP_ID, LOCALE_IMPORT } from './util/ids';
export type { DtsOptions, RuntimeModuleOptions } from './emit/codegen';

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
  writeBuildTypes,
} from './emit/plugin';
export type { PluginOptions } from './emit/plugin';
export { transformCode } from './scan/transform';
// next, vite and unplugin say it when they start: a file outside include that writes a t`…`
export { reportOutsideInclude } from './scan/scope';
export type { TransformResult } from './scan/transform';

export { check, formatCheckResult, formatCheckWarnings } from './gate/check';
// public because the dev servers and the MCP server word every finding the way extract does
export {
  collisionEntries,
  createDevReporter,
  formatCollision,
  formatFinding,
} from './gate/findings';
export type { DevReporter, Finding } from './gate/findings';
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
} from './gate/check';
// both are public because Studio has to run the same two checks the gate runs before it writes
export { validateMessage, validatePair } from './gate/validate';
// StructureIssue is what those two return, so typed code cannot hold a result without it
export type { IssueSeverity, StructureIssue } from './gate/validate';

export { formatStatusResult, status } from './gate/status';
export type { LocaleStatus, StatusResult } from './gate/status';

export { counted } from './util/text';
// formatCliError is public so a new entry point prefixes [verbaly] the one documented way
export { formatCliError } from './cli/run';

// clearDrafts is public because @verbaly/studio is where a person approves what a machine wrote.
export { clearDrafts, effectiveDrafts, loadDrafts, markDrafts, saveDrafts } from './catalog/drafts';
// the state follows the catalogs wherever they are written: the CLI, the MCP server and dev servers
export { loadState, outdatedTranslations, STATE_FILE, updateState } from './catalog/state';
// read tolerantly where it only feeds warnings, and recorded wherever a translation is written
export { readState, recordTranslations } from './catalog/state';
export type { Drafts, Fingerprints, State, TranslationWrite } from './catalog/state';

// mergeTranslations is public because the CLI, the MCP server and Studio all write a finished run
export {
  formatTranslateFailures,
  mergeTranslations,
  resolveProvider,
  translateCatalogs,
  writeDrafts,
} from './exchange/translate';
export type { DraftEntry, WriteDraftsResult } from './exchange/translate';

// watchTree is public because @verbaly/next watches its dev tree with the same walk the CLI uses
export { watchTree } from './emit/watch';
export type { TreeOptions } from './emit/watch';

// formatDoctorHealth: the CLI and verbaly_doctor say the same verdict under the same entries
export { doctor, formatDoctorEntry, formatDoctorHealth } from './project/doctor';
export { init } from './project/init';
export type { Host, InitOptions, InitResult } from './project/init';
export type { DoctorEntry, DoctorResult } from './project/doctor';

export { wrapProject } from './scan/wrap';
export type { WrapBlocked, WrapEntry, WrapOptions, WrapResult, WrapSkip } from './scan/wrap';

export { formatRenderWarnings, renderSite } from './emit/render';
export type { RenderSiteOptions, RenderSiteResult } from './emit/render';
