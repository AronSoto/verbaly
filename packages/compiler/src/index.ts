export { analyze } from './analyze';
export { SFC_FILE_RE, analyzeFile, analyzeSfc } from './sfc';
export { loadCatalogs, readCatalog, catalogPath, serializeCatalog, writeCatalog } from './catalog';
export {
  check,
  checkNextSteps,
  formatCheckResult,
  formatCheckWarnings,
  gatePasses,
  githubCheckAnnotations,
} from './check';
export { PLURAL_CATEGORIES, validateMessage, validatePair } from './validate';
export {
  VIRTUAL_ID,
  generateDts,
  generateLocaleModule,
  generateRuntimeModule,
  writeDts,
} from './codegen';
export { findConfigFile, loadConfig, loadConfigFile, resolveConfig, targetLocales } from './config';
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
export { doctor } from './doctor';
export {
  DRAFTS_FILE,
  clearDrafts,
  effectiveDrafts,
  loadDrafts,
  markDrafts,
  saveDrafts,
} from './drafts';
export { exportCatalogs, importCatalogs, isMobileFormat, parseExchangeFile } from './exchange';
export { collectOrigins, extractProject, pruneCatalogs, syncCatalogs } from './extract';
export { WIRING_PACKAGES, detectHost, init, readDependencies } from './init';
export { stableKey } from './key';
export { collectParams, renderParamType } from './params';
export { claudeProvider } from './providers/claude';
export { PSEUDO_LOCALE, pseudoCatalogs, pseudoLocalize } from './pseudo';
export { renderHtml, renderSite } from './render';
export { MessageRegistry } from './registry';
export { formatStatusResult, status } from './status';
export { watchProject } from './watch';
export { transformCode } from './transform';
export { wrapCode, wrapProject } from './wrap';
export { resolveProvider, structureMatches, translateCatalogs } from './translate';

export type {
  Analysis,
  AnalyzeOptions,
  StrayImport,
  TaggedMessage,
  TaggedParam,
  TransComponent,
  UsedKey,
} from './analyze';
export type { RuntimeModuleOptions } from './codegen';
export type { Catalog, Catalogs } from './catalog';
export type { Drafts } from './drafts';
export type { BrokenEntry, CheckResult, MissingEntry, UnknownEntry } from './check';
export type { IssueSeverity, StructureIssue } from './validate';
export type { DoctorEntry, DoctorResult } from './doctor';
export type {
  ExchangeFormat,
  ExportFormat,
  ExportOptions,
  ExportResult,
  ExportedFile,
  ImportOptions,
  ImportResult,
  MobileFormat,
} from './exchange';
export type { RenderConfig, ResolvedConfig, TranslateConfig, VerbalyConfig } from './config';
export type { PluginOptions } from './plugin';
export type { SyncResult } from './extract';
export type { LocaleStatus, StatusResult } from './status';
export type { WatchProjectOptions } from './watch';
export type { Host, HostSetup, InitOptions, InitResult } from './init';
export type {
  Alternate,
  RenderHtmlOptions,
  RenderHtmlResult,
  RenderSiteOptions,
  RenderSiteResult,
} from './render';
export type { ClaudeProviderOptions } from './providers/claude';
export type {
  TranslateOptions,
  TranslateProvider,
  TranslateRequest,
  TranslateResult,
} from './translate';
export type { ParamType } from './params';
export type { TransformResult } from './transform';
export type { WrapCodeResult, WrapEntry, WrapOptions, WrapResult, WrapSkip } from './wrap';
