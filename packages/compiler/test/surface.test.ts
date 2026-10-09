import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as compiler from '../src/index';

// Adding an export must change this list too: the rule it has to pass lives in the dev skill.
const VALUES = [
  'LOCALE_MODULE_PREFIX',
  'MessageRegistry',
  'RESOLVED_VIRTUAL_ID',
  'SOURCE_FILE_RE',
  'STATE_FILE',
  'check',
  'clearDrafts',
  'clientCatalogs',
  'collectOrigins',
  'collisionEntries',
  'counted',
  'createDevReporter',
  'createSourceFilter',
  'doctor',
  'effectiveDrafts',
  'extractProject',
  'formatCheckResult',
  'formatCheckWarnings',
  'formatCliError',
  'formatCollision',
  'formatDoctorEntry',
  'formatFinding',
  'formatRenderWarnings',
  'formatStatusResult',
  'formatTranslateFailures',
  'generateDts',
  'generateLocaleModule',
  'generateRuntimeModule',
  'init',
  'isTransformTarget',
  'loadCatalogs',
  'loadConfig',
  'loadDrafts',
  'loadState',
  'loadVirtualModule',
  'markDrafts',
  'mergeTranslations',
  'needsIcu',
  'needsRelative',
  'outdatedTranslations',
  'parseCatalog',
  'pruneCatalogs',
  'readCatalog',
  'readState',
  'recordTranslations',
  'renderSite',
  'reportOutsideInclude',
  'resolveConfig',
  'resolveProvider',
  'resolveVirtualId',
  'runBuildGate',
  'saveDrafts',
  'shippedCatalogs',
  'stableKey',
  'status',
  'syncCatalogs',
  'syncProject',
  'targetLocales',
  'transformCode',
  'transformSource',
  'translateCatalogs',
  'updateState',
  'validateMessage',
  'validatePair',
  'watchTree',
  'wrapProject',
  'writeCatalog',
  'writeDrafts',
  'writeDts',
];

const TYPES = [
  'BrokenEntry',
  'BundleConfig',
  'Catalog',
  'Catalogs',
  'CheckResult',
  'CollisionEntry',
  'DevReporter',
  'DivergentEntry',
  'DoctorEntry',
  'DoctorResult',
  'DraftEntry',
  'Drafts',
  'DtsOptions',
  'ExtraEntry',
  'Finding',
  'Fingerprints',
  'GlossaryEntry',
  'Host',
  'InitOptions',
  'InitResult',
  'IssueSeverity',
  'LocaleStatus',
  'MissingEntry',
  'OutdatedEntry',
  'PluginOptions',
  'RedirectConfig',
  'RenderConfig',
  'RenderSiteOptions',
  'RenderSiteResult',
  'ResolvedConfig',
  'RuntimeModuleOptions',
  'SourceSite',
  'State',
  'StatusResult',
  'StructureIssue',
  'SyncProjectResult',
  'SyncResult',
  'TransformResult',
  'TranslateConfig',
  'TranslateFailure',
  'TranslateOptions',
  'TranslateProgress',
  'TranslateProvider',
  'TranslateRequest',
  'TranslateResult',
  'TranslationWrite',
  'TreeOptions',
  'UnknownEntry',
  'VerbalyConfig',
  'WrapBlocked',
  'WrapEntry',
  'WrapOptions',
  'WrapResult',
  'WrapSkip',
  'WriteDraftsResult',
];

function declared(): { values: string[]; types: string[] } {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'index.ts'), 'utf8');
  const values: string[] = [];
  const types: string[] = [];
  for (const match of src.matchAll(/export (type )?\{([^}]*)\} from '[^']*'/gs)) {
    for (const raw of match[2]!
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      (match[1] || raw.startsWith('type ') ? types : values).push(raw.replace(/^type /, ''));
    }
  }
  return { values: values.sort(), types: types.sort() };
}

describe('public surface', () => {
  it('exports exactly the reviewed value list', () => {
    // the runtime module, so index.ts cannot claim an export it does not deliver
    expect(Object.keys(compiler).sort()).toEqual(VALUES);
  });

  it('declares exactly the reviewed type list', () => {
    // types are erased at runtime, so this arm reads the source
    expect(declared().types).toEqual(TYPES);
  });

  it('keeps the declared values and the delivered values in agreement', () => {
    expect(declared().values).toEqual(Object.keys(compiler).sort());
  });

  it('keeps the extraction internals out of the surface', () => {
    // the audit's whole point: a bundler plugin gets messages, never the AST types behind them
    const internals = ['analyze', 'analyzeFile', 'analyzeSfc'];
    for (const name of internals) expect(compiler).not.toHaveProperty(name);
  });
});
