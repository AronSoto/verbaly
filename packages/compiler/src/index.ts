export { analyze } from './analyze';
export { SFC_FILE_RE, analyzeFile, analyzeSfc } from './sfc';
export { loadCatalogs, readCatalog, catalogPath, serializeCatalog, writeCatalog } from './catalog';
export { check, formatCheckResult } from './check';
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
  isTransformTarget,
  loadVirtualModule,
  resolveVirtualId,
  runBuildGate,
} from './plugin';
export { doctor } from './doctor';
export { exportCatalogs, importCatalogs, parseExchangeFile } from './exchange';
export { extractProject, pruneCatalogs, syncCatalogs } from './extract';
export { detectBundler, init } from './init';
export { stableKey } from './key';
export { collectParams, renderParamType } from './params';
export { claudeProvider } from './providers/claude';
export { PSEUDO_LOCALE, pseudoCatalogs, pseudoLocalize } from './pseudo';
export { renderHtml, renderSite } from './render';
export { MessageRegistry } from './registry';
export { transformCode } from './transform';
export { structureMatches, translateCatalogs } from './translate';

export type {
  Analysis,
  AnalyzeOptions,
  TaggedMessage,
  TaggedParam,
  TransComponent,
  UsedKey,
} from './analyze';
export type { RuntimeModuleOptions } from './codegen';
export type { Catalog, Catalogs } from './catalog';
export type { CheckResult, MissingEntry, UnknownEntry } from './check';
export type { DoctorEntry, DoctorResult } from './doctor';
export type {
  ExchangeFormat,
  ExportOptions,
  ExportResult,
  ExportedFile,
  ImportOptions,
  ImportResult,
} from './exchange';
export type { RenderConfig, ResolvedConfig, TranslateConfig, VerbalyConfig } from './config';
export type { SyncResult } from './extract';
export type { InitOptions, InitResult } from './init';
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
