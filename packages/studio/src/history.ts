import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative } from 'node:path';
import type { ResolvedConfig } from '@verbaly/compiler';

const run = promisify(execFile);

export interface Commit {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

// one field separator that no subject can contain, written as the escape and never as the byte
const FIELD = '';
const FORMAT = `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s`;

// split out so the shape of a log line is tested without a repository and without writing one
export function parseLog(stdout: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of stdout.split('\n')) {
    const [sha, author, date, ...rest] = line.split(FIELD);
    // a subject holds anything but a newline, so it is the last field and is rejoined
    if (!sha || !author || !date || !rest.length) continue;
    commits.push({ sha: sha.slice(0, 7), author, date, subject: rest.join(FIELD) });
  }
  return commits;
}

// git is asked, never assumed: no repository and no git both mean there is no history to show
export async function catalogHistory(cfg: ResolvedConfig, limit = 5): Promise<Commit[]> {
  const dir = relative(cfg.root, cfg.dir).replaceAll('\\', '/') || '.';
  try {
    const { stdout } = await run('git', ['log', `-n${limit}`, FORMAT, '--', dir], {
      cwd: cfg.root,
      timeout: 3000,
      windowsHide: true,
    });
    return parseLog(stdout);
  } catch {
    return [];
  }
}
