import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import { SOURCE_EXTENSIONS, type ResolvedConfig } from './config';
import { analyzeFile } from './sfc';
import { warnOnce } from './warn';

// a hint before Babel is asked: t`, t.id('…')` or a Svelte $t`
const TAGGED_HINT = /(?<![\w$.])\$?t(?:\.id\s*\([^)]*\))?\s*`/;

// folders that hold builds or vendored code, never the app's own source
const NOT_SOURCE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
];

function relativeId(cfg: ResolvedConfig, id: string): string {
  return relative(cfg.root, id).replaceAll('\\', '/');
}

// the include pattern that would cover a file: its top folder with the extensions extract reads
function suggestedPattern(rel: string): string {
  const slash = rel.indexOf('/');
  return slash < 0 ? rel : `${rel.slice(0, slash)}/**/*.${SOURCE_EXTENSIONS}`;
}

export interface OutsideFile {
  file: string;
  pattern: string;
}

// a file the build reads and extract never will: its t`…` shows the source text in every language
export function createOutsideCheck(
  cfg: ResolvedConfig,
): (code: string, id: string) => OutsideFile | undefined {
  // include: [] turns scanning off on purpose, so nothing is outside of it
  if (cfg.include.length === 0) return () => undefined;
  const included = picomatch(cfg.include);
  const excluded = picomatch(cfg.exclude);
  return (code, id) => {
    const rel = relativeId(cfg, id);
    if (rel.startsWith('..') || included(rel) || excluded(rel)) return undefined;
    if (!TAGGED_HINT.test(code)) return undefined;
    // the hint matches prose too: only a real tagged template on t counts
    if (analyzeFile(code, id).tagged.length === 0) return undefined;
    return { file: id, pattern: suggestedPattern(rel) };
  };
}

// one wording for the loader, both plugins and doctor
export function formatOutside(cfg: ResolvedConfig, found: OutsideFile): string {
  return (
    `${relativeId(cfg, found.file)} uses t\`…\` outside the include of your verbaly config, so its ` +
    `texts are never extracted and show in ${cfg.sourceLocale} in every language: add ` +
    `"${found.pattern}" to include (or the file to exclude, if it is not app code)`
  );
}

// once when a build or a dev server starts: a loader result can come from a cache, a scan cannot
export async function reportOutsideInclude(cfg: ResolvedConfig): Promise<void> {
  for (const found of await filesOutsideInclude(cfg)) {
    warnOnce(formatOutside(cfg, found), `outside:${found.file}`);
  }
}

// the whole project, for doctor: every source file outside include that writes a t`…`
export async function filesOutsideInclude(cfg: ResolvedConfig): Promise<OutsideFile[]> {
  if (cfg.include.length === 0) return [];
  const check = createOutsideCheck(cfg);
  const files = await glob([`**/*.${SOURCE_EXTENSIONS}`], {
    cwd: cfg.root,
    ignore: [...NOT_SOURCE, ...cfg.exclude],
    absolute: true,
  });
  const found: OutsideFile[] = [];
  for (const file of files.sort()) {
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const outside = check(code, file);
    if (outside) found.push(outside);
  }
  return found;
}
