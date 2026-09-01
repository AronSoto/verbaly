import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { flatten, type MessageTree } from 'verbaly';
import { auditBundle, formatBundleIssue } from './bundle';
import { badLeaf, type Catalogs } from './catalog';
import { check } from './check';
import { generateDts } from './codegen';
import { findConfigFile, type ResolvedConfig } from './config';
import { extractProject } from './extract';
import { CLI_INSTALL_FIX, cliReachable, detectHost, readDependencies, WIRING_PACKAGES } from './init';
import { counted } from './text';
import { escapedSyntax } from './validate';

export interface DoctorEntry {
  level: 'ok' | 'warn' | 'error';
  check: string;
  message: string;
  fix?: string;
}

export interface DoctorResult {
  ok: boolean; // no error-level entries (warns allowed)
  entries: DoctorEntry[];
}

const PREVIEW = 5; // keys shown before "…"

// a mode nobody wrote down was inferred, and doctor says which of the two it is reading
function readRoutingChoice(root: string, configFile: string): boolean {
  try {
    return /\brouting["']?\s*[:=]/.test(readFileSync(join(root, configFile), 'utf8'));
  } catch {
    return false;
  }
}

const ROUTING_SAYS: Record<ResolvedConfig['routing'], string> = {
  'prefix-except-source': 'the source locale has no prefix, every other locale does',
  'prefix-all': 'every locale has a prefix, the source included',
  'no-prefix': 'the language is not in the url, one address serves every locale',
};

const ICON = { ok: '✓', warn: '⚠', error: '✗' } as const;

// one definition of a doctor line: the cli routes it by level, the mcp tool joins the block
export function formatDoctorEntry(entry: DoctorEntry): string {
  const head = `  ${ICON[entry.level]} ${entry.check}: ${entry.message}`;
  return entry.fix
    ? `${head}
      fix: ${entry.fix}`
    : head;
}

export async function doctor(cfg: ResolvedConfig): Promise<DoctorResult> {
  const entries: DoctorEntry[] = [];
  const ok = (name: string, message: string) => entries.push({ level: 'ok', check: name, message });
  const warn = (name: string, message: string, fix: string) =>
    entries.push({ level: 'warn', check: name, message, fix });
  const error = (name: string, message: string, fix: string) =>
    entries.push({ level: 'error', check: name, message, fix });
  const rel = (path: string) => relative(cfg.root, path).replaceAll('\\', '/');

  const configFile = findConfigFile(cfg.root);
  if (configFile) ok('config', `${configFile} found`);
  else warn('config', 'no config file, running on defaults', 'run `npx verbaly init`');

  // the build works without it: what breaks is every command we tell people to run
  if (cliReachable(cfg.root)) ok('cli', 'the verbaly command is available in this project');
  else warn('cli', 'the verbaly command is not linked in node_modules/.bin', CLI_INSTALL_FIX);

  const catalogs: Catalogs = {};
  let catalogsHealthy = true;
  if (!existsSync(cfg.dir)) {
    catalogsHealthy = false;
    error(
      'catalogs',
      `catalogs directory ${rel(cfg.dir)}/ does not exist`,
      'run `npx verbaly init` to scaffold it',
    );
  } else {
    for (const locale of cfg.locales) {
      const file = join(cfg.dir, `${locale}.json`);
      if (!existsSync(file)) {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is missing`,
          'run `npx verbaly extract` to create it',
        );
        continue;
      }
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as MessageTree;
        // nested groups are a real shape: only a leaf that is not text is broken
        const bad = badLeaf(parsed);
        if (bad) {
          catalogsHealthy = false;
          error(
            `locale ${locale}`,
            `${rel(file)} has a non-string value at "${bad}"`,
            'catalog values are text (groups of text are fine); fix the value',
          );
        } else {
          catalogs[locale] = flatten(parsed);
        }
      } catch {
        catalogsHealthy = false;
        error(
          `locale ${locale}`,
          `${rel(file)} is not valid JSON`,
          'repair the file (or delete it and run `npx verbaly extract`)',
        );
      }
    }
    if (catalogsHealthy) {
      const how = cfg.localesDeclared ? '' : ', no locales set, so the catalog files decide';
      ok(
        'catalogs',
        `${counted(cfg.locales.length, 'locale')} (${cfg.locales.join(', ')}) in ${rel(cfg.dir)}/${how}`,
      );
    }
  }

  const source = catalogs[cfg.sourceLocale];
  if (source && Object.keys(source).length === 0) {
    warn(
      'source',
      `source catalog ${cfg.sourceLocale}.json is empty`,
      'write your first t`…` message and run `npx verbaly extract`',
    );
  }

  const mirrors = cfg.render.site !== undefined || Object.keys(cfg.render).length > 0;
  if (cfg.routing === 'no-prefix' && mirrors) {
    warn(
      'routing',
      'routing is "no-prefix" but a render section is configured, and render writes one url tree per locale',
      'drop the render section, or set routing to "prefix-except-source" so the helpers agree with the urls',
    );
  } else {
    const named = configFile ? readRoutingChoice(cfg.root, configFile) : false;
    const how = named ? '' : ' (from your setup, no routing set)';
    ok('routing', `${cfg.routing}${how}: ${ROUTING_SAYS[cfg.routing]}`);
  }

  const deps = readDependencies(cfg.root);
  const host = detectHost(cfg.root);
  const installed = WIRING_PACKAGES.find((pkg) => deps[pkg]);
  if (!host) {
    ok('plugin', 'no framework or bundler detected, the CLI flow (extract/check) applies');
  } else if (installed) {
    ok('plugin', `${installed} installed for ${host.name}`);
  } else {
    warn(
      'plugin',
      `${host.name} detected but ${host.pkg} is not installed`,
      `pnpm add -D ${host.pkg} and ${host.wire}`,
    );
  }

  // with include: [] no code is read, so orphans and types cannot be claimed here
  const scanning = cfg.include.length > 0;
  if (!scanning) {
    ok('sources', 'source scanning is off (include: []), the catalogs are the source of truth');
  }

  if (source && scanning && cfg.dts !== false) {
    const dtsPath = cfg.dts ?? join(cfg.root, 'verbaly.d.ts');
    if (!existsSync(dtsPath)) {
      warn('types', 'verbaly.d.ts has not been generated', 'run `npx verbaly extract`');
    } else if (readFileSync(dtsPath, 'utf8') !== generateDts(source)) {
      warn('types', 'verbaly.d.ts is stale', 'run `npx verbaly extract`');
    } else {
      ok('types', 'verbaly.d.ts is up to date');
    }
  }

  const registry = await extractProject(cfg);
  if (scanning) {
    // a warn, not an error: decorators or a dialect babel does not read still build in the project
    const unreadable = registry.parseErrors();
    if (unreadable.length > 0) {
      const first = unreadable[0]!;
      warn(
        'sources',
        `could not parse ${counted(unreadable.length, 'file')}, so the messages inside are not extracted (${rel(first.file)}: ${first.message})`,
        'fix the syntax error, or exclude the file in your config if it is not source',
      );
    }
    const stray = registry.strayImports();
    if (stray.length > 0) {
      const files = [...new Set(stray.map((entry) => rel(entry.file)))];
      error(
        'imports',
        `t is imported from a verbaly package, which never exports it, in ${counted(files.length, 'file')} (${preview(files)})`,
        't comes from your instance (React: const t = useT()) or from virtual:verbaly',
      );
    }
    const escaped = [...registry.messages().values()]
      .map((msg) => ({ file: rel(msg.file), slice: escapedSyntax(msg.message) }))
      .filter((entry) => entry.slice !== undefined);
    if (escaped.length > 0) {
      warn(
        'messages',
        `a block ships as literal text in ${counted(escaped.length, 'extracted message')} (${escaped[0]!.file}: ${escaped[0]!.slice})`,
        'a tagged template takes its values from ${…}: use t(key, params) for a plural or format block',
      );
    }
  }
  if (source && scanning) {
    const extracted = registry.messages();
    const used = registry.usedKeys();
    const orphans = Object.keys(source).filter((key) => !extracted.has(key) && !used.has(key));
    if (orphans.length > 0) {
      warn(
        'orphans',
        `${counted(orphans.length, 'catalog key')} no longer referenced in code (${preview(orphans)})`,
        'run `npx verbaly extract --prune` to drop them',
      );
    } else {
      ok('orphans', 'no orphan keys');
    }
  }

  const excluded = cfg.bundle.exclude ?? [];
  if (excluded.length > 0 && catalogsHealthy) {
    const issues = auditBundle(cfg, catalogs, registry);
    for (const issue of issues) warn('bundle', formatBundleIssue(issue), issue.fix);
    if (issues.length === 0) {
      ok(
        'bundle',
        `${counted(excluded.length, 'group')} kept out of the client (${preview(excluded)})`,
      );
    }
  }

  if (catalogsHealthy) {
    const result = check(cfg, catalogs, registry);
    if (result.unknown.length > 0) {
      error(
        'keys',
        `${counted(result.unknown.length, 'unknown key')} used in code (${preview(result.unknown.map((u) => u.key))})`,
        'fix the key or add it to the catalogs (`npx verbaly check` for details)',
      );
    }
    if (result.missing.length > 0) {
      const locales = [...new Set(result.missing.map((m) => m.locale))];
      warn(
        'translations',
        `${counted(result.missing.length, 'missing translation')} (${locales.join(', ')})`,
        'run `npx verbaly translate` or fill the catalogs (`npx verbaly check` for details)',
      );
    }
    // the gate fails on these, so doctor cannot keep calling the setup healthy
    const broken = result.broken.filter((entry) => entry.severity === 'error');
    if (broken.length > 0) {
      const locales = [...new Set(broken.map((b) => b.locale))];
      error(
        'translations',
        `${counted(broken.length, 'broken translation')} (${locales.join(', ')}): present but not rendering what the source renders`,
        'run `npx verbaly check` to read what each one lost',
      );
    }
    const warnings = result.broken.filter((entry) => entry.severity === 'warning');
    if (warnings.length > 0) {
      warn(
        'translations',
        `${counted(warnings.length, 'structural warning')} (plural forms a language asks for)`,
        'run `npx verbaly check` to read them, they never fail the build',
      );
    }
    if (result.ok) ok('translations', 'all translations complete');
  }

  return { ok: entries.every((entry) => entry.level !== 'error'), entries };
}

function preview(keys: string[]): string {
  const head = keys.slice(0, PREVIEW).join(', ');
  return keys.length > PREVIEW ? `${head}, …` : head;
}
