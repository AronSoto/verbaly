import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { glob } from 'tinyglobby';
import { emptyCatalog } from '../catalog/catalog';
import type { Analysis } from './analyze';
import type { ResolvedConfig } from '../config/config';
import { MessageRegistry } from './registry';
import { analyzeFile } from './sfc';
import { relativePath, slashed } from '../util/path';

// what a build's scan read, file by file, until its transform takes each one
const kept = new WeakMap<MessageRegistry, Map<string, { code: string; analysis: Analysis }>>();

// how many files a scan has open at once where reads overlap
export const READ_WINDOW = 64;

// Windows pays its antivirus on every open, so reads overlap there; elsewhere a sync read wins
export async function readSources(
  files: readonly string[],
  each: (file: string, code: string) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') {
    for (const file of files) each(file, readFileSync(file, 'utf8'));
    return;
  }
  for (let at = 0; at < files.length; at += READ_WINDOW) {
    const window = files.slice(at, at + READ_WINDOW);
    const read = await Promise.all(
      window.map(async (file) => [file, await readFile(file, 'utf8')] as const),
    );
    // read together, handed on in the given order: which read lands first changes nothing
    for (const [file, code] of read) each(file, code);
  }
}

// keepSource: a build that transforms next takes these analyses instead of parsing every file again
export async function extractProject(
  cfg: ResolvedConfig,
  options: { keepSource?: boolean } = {},
): Promise<MessageRegistry> {
  const files = await glob(cfg.include, {
    cwd: cfg.root,
    ignore: cfg.exclude,
    absolute: true,
  });
  const registry = new MessageRegistry();
  const read = options.keepSource ? new Map<string, { code: string; analysis: Analysis }>() : null;
  // tinyglobby crawls sibling folders in parallel, so its order changes from one run to the next
  await readSources(files.sort(), (file, code) => {
    const analysis = analyzeFile(code, file);
    registry.update(file, analysis);
    read?.set(slashed(file), { code, analysis });
  });
  if (read) kept.set(registry, read);
  return registry;
}

// the scan's analysis of a file, handed out once and only when the code is what the scan read
export function scannedAnalysis(
  scan: MessageRegistry,
  file: string,
  code: string,
): Analysis | undefined {
  const read = kept.get(scan);
  const key = slashed(file);
  const entry = read?.get(key);
  read?.delete(key);
  return entry?.code === code ? entry.analysis : undefined;
}

// root-relative with forward slashes so a translator reads the same path on any OS, one scan
export async function collectOrigins(
  cfg: ResolvedConfig,
  reuse?: MessageRegistry,
): Promise<Record<string, string[]>> {
  const registry = reuse ?? (await extractProject(cfg));
  const origins = emptyCatalog<string[]>();
  for (const [key, files] of registry.origins()) {
    origins[key] = files.map((file) => relativePath(cfg.root, file));
  }
  return origins;
}
