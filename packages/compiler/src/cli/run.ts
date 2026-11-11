import { relative } from 'node:path';
import { loadConfig, type ResolvedConfig } from '../config/config';
import { csv, parseCli, type CliValues } from './args';
import { checkCommand } from './commands/check';
import { doctorCommand } from './commands/doctor';
import { exportCommand } from './commands/export';
import { extractCommand } from './commands/extract';
import { importCommand } from './commands/import';
import { initCommand } from './commands/init';
import { migrateCommand } from './commands/migrate';
import { pseudoCommand } from './commands/pseudo';
import { renderCommand } from './commands/render';
import { reviewCommand } from './commands/review';
import { statusCommand } from './commands/status';
import { translateCommand } from './commands/translate';
import { typegenCommand } from './commands/typegen';
import { wrapCommand } from './commands/wrap';

const HELP = `verbaly · i18n compiler

Usage:
  verbaly init       scaffold config + locale catalogs (detects your framework)
  verbaly doctor     diagnose the setup (config, catalogs, plugin, types, keys)
  verbaly wrap       find hardcoded JSX text and wrap it in t\`…\` (report; --write applies)
  verbaly migrate    port catalogs from another i18n library (report; --write applies)
  verbaly extract    scan sources, update catalogs and types
  verbaly typegen    write the TypeScript types only (CI: run it before tsc)
  verbaly status     translation coverage per locale, at a glance
  verbaly check      verify translations are complete (CI)
  verbaly translate  fill missing translations via a provider (default: claude)
  verbaly review [keys…]  list translations awaiting review: machine drafts and outdated ones (--approve accepts them)
  verbaly export     write translator files (XLIFF 2.0, CSV, gettext PO) or mobile resources (Android, iOS)
  verbaly import <files…>  fill catalogs back from translated XLIFF/CSV/PO files
  verbaly pseudo     generate a pseudo-locale catalog for i18n QA (default: en-XA)
  verbaly render     pre-fill data-verbaly HTML per locale (SSG, kills the FOUC)

Options:
  --root <path>      project root (default: cwd)
  --dir <path>       catalogs directory (default: locales)
  --source <locale>  source locale (default: en)
  --locales <csv>    run on these locales only, the source always included (init: the ones to create)
  --prune            drop keys no longer referenced (extract)
  --watch            keep extracting as source files change (extract)
  --write            apply the rewrites instead of only reporting (wrap, migrate)
  --plurals          also merge _one/_other into one message with variants (migrate)
  --json             machine-readable output (status)
  --drafts           also fail on unreviewed machine translations (check)
  --outdated         also fail on translations written for an older source text (check)
  --approve          accept what review lists, drafts and outdated, or only the keys given (review)
  --reporter <name>  failure format: text (default) or github annotations (check)
  --model <id>       model override for the claude provider (translate)
  --dry-run          list what would happen, write nothing (translate, import, extract)
  --format <f>       export format: xliff (default), csv, po, android-xml or ios-strings (export)
  --out <path>       export directory (export, default: verbaly-export)
  --missing          export only untranslated entries (export)
  --overwrite        replace existing translations on import (import)
  --draft            mark what the files bring as drafts a person still has to review (import)
  --locale <id>      pseudo-locale id (pseudo) / one locale only (review, import)
  --site <path>      built site directory (render, default: dist)
  --attribute <name> base data attribute (render, default: data-verbaly)
  --base <path>      subpath the site is served under, e.g. /app (render)
  --base-url <url>   site origin, enables hreflang alternates (render)
  --sitemap          emit sitemap-i18n.xml with per-locale alternates (render)
  --redirect         send a visitor on the root to their mirror, pre-paint (render)
  --clean            remove existing locale dirs before mirroring (render)

Config file: verbaly.config.{js,mjs,ts,mts,json} at root (flags win).
The claude provider needs @anthropic-ai/sdk installed and ANTHROPIC_API_KEY set.
`;

type Command = (cfg: ResolvedConfig, values: CliValues, positionals: string[]) => Promise<void>;

// every command but init, which runs before a config exists
const COMMANDS: Record<string, Command> = {
  doctor: doctorCommand,
  extract: extractCommand,
  typegen: typegenCommand,
  migrate: migrateCommand,
  wrap: wrapCommand,
  status: statusCommand,
  check: checkCommand,
  translate: translateCommand,
  review: reviewCommand,
  export: exportCommand,
  import: importCommand,
  render: renderCommand,
  pseudo: pseudoCommand,
};

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const { positionals, values } = parseCli(args);

  const command = positionals[0];
  // asking for help is not a usage error, even with no command: only bare `verbaly` is
  if (values.help || !command) {
    console.log(HELP);
    process.exitCode = values.help ? 0 : 1;
    return;
  }

  if (rejectStrayFlags(command, values)) return;

  if (command === 'init') return initCommand(values);

  // a command name is data: constructor or toString is no command either, and it is said first
  if (!Object.hasOwn(COMMANDS, command)) {
    console.error(`[verbaly] unknown command "${command}"\n${HELP}`);
    process.exitCode = 1;
    return;
  }

  const root = values.root ?? process.cwd();
  const project = { dir: values.dir, sourceLocale: values.source };
  const narrowed = csv(values.locales);
  if (narrowed || (command === 'review' && values.locale)) {
    // the languages before the flag narrows them: a typo is not a language with nothing to do
    const whole = await loadConfig(root, project);
    const typo = narrowed
      ? strangers(whole, 'locales', narrowed)
      : strangers(whole, 'locale', [values.locale!]);
    if (typo) {
      console.error(typo);
      process.exitCode = 1;
      return;
    }
  }

  const cfg = await loadConfig(root, { ...project, locales: narrowed });
  return COMMANDS[command]!(cfg, values, positionals);
}

// a locale flag picks among the project's languages; only init starts one from a flag
function strangers(cfg: ResolvedConfig, flag: string, named: string[]): string | undefined {
  const unknown = named.filter((locale) => !cfg.locales.includes(locale));
  if (unknown.length === 0) return undefined;
  const dir = relative(cfg.root, cfg.dir).replaceAll('\\', '/');
  const start = cfg.localesDeclared
    ? `add ${unknown.join(', ')} to locales in your verbaly config`
    : // an empty file is not a catalog: the line says what goes in it
      `create ${unknown.map((locale) => `${dir}/${locale}.json`).join(', ')} holding {}`;
  const names = unknown.map((locale) => `"${locale}"`).join(', ');
  return `[verbaly] --${flag} names ${names}, and this project has ${cfg.locales.join(', ')}\n    fix: check the spelling, or ${start} to start a new language`;
}

// every compiler error already opens with [verbaly]: prefix only what does not
export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith('[verbaly]') ? message : `[verbaly] ${message}`;
}

// flags shared by every command (config overrides)
const COMMON_FLAGS = new Set(['root', 'dir', 'source', 'locales', 'help']);
export const COMMAND_FLAGS: Record<string, string[]> = {
  init: [],
  doctor: [],
  extract: ['prune', 'dry-run', 'watch'],
  typegen: [],
  wrap: ['write'],
  migrate: ['write', 'plurals'],
  status: ['json'],
  check: ['reporter', 'drafts', 'outdated'],
  translate: ['model', 'dry-run'],
  review: ['approve', 'locale'],
  export: ['format', 'out', 'missing'],
  import: ['locale', 'overwrite', 'dry-run', 'draft'],
  pseudo: ['locale'],
  render: ['site', 'attribute', 'base', 'base-url', 'sitemap', 'redirect', 'clean'],
};

// a flag another command owns must fail loudly, never be silently ignored
function rejectStrayFlags(command: string, values: Record<string, unknown>): boolean {
  // unknown command: reported later with the help text
  if (!Object.hasOwn(COMMAND_FLAGS, command)) return false;
  const allowed = new Set([...COMMON_FLAGS, ...COMMAND_FLAGS[command]!]);
  const stray = Object.keys(values).filter((k) => values[k] !== undefined && !allowed.has(k));
  if (stray.length === 0) return false;
  for (const flag of stray) {
    const hint = flag === 'locale' ? ' (did you mean --locales?)' : '';
    console.error(`[verbaly] --${flag} is not a "${command}" flag${hint}`);
  }
  process.exitCode = 1;
  return true;
}
