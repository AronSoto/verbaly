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

// git is asked, never assumed: no repository and no git both mean there is no history to show
export async function catalogHistory(cfg: ResolvedConfig, limit = 5): Promise<Commit[]> {
  const dir = relative(cfg.root, cfg.dir).replaceAll('\\', '/') || '.';
  let stdout: string;
  try {
    const result = await run('git', ['log', `-n${limit}`, FORMAT, '--', dir], {
      cwd: cfg.root,
      timeout: 3000,
      windowsHide: true,
    });
    stdout = result.stdout;
  } catch {
    return [];
  }

  const commits: Commit[] = [];
  for (const line of stdout.split('\n')) {
    const [sha, author, date, ...rest] = line.split(FIELD);
    // a subject can hold anything but a newline, so it is the last field and is rejoined
    if (!sha || !author || !date) continue;
    commits.push({ sha: sha.slice(0, 7), author, date, subject: rest.join(FIELD) });
  }
  return commits;
}
