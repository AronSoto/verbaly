import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { join, relative } from 'node:path';
import { parseCatalog, type Catalog, type ResolvedConfig } from '@verbaly/compiler';

const run = promisify(execFile);

export interface Commit {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

// one field separator that no subject can contain, written as the escape and never as the byte
const FIELD = '\u001f';
const FORMAT = `--format=%H${FIELD}%an${FIELD}%aI${FIELD}%s`;

// the full sha is what git resolves without ambiguity, and seven characters is what a card shows
export function parseFullLog(stdout: string): Commit[] {
  const commits: Commit[] = [];
  for (const line of stdout.split('\n')) {
    const [sha, author, date, ...rest] = line.split(FIELD);
    // a subject holds anything but a newline, so it is the last field and is rejoined
    if (!sha || !author || !date || !rest.length) continue;
    commits.push({ sha, author, date, subject: rest.join(FIELD) });
  }
  return commits;
}

// split out so the shape of a log line is tested without a repository and without writing one
export function parseLog(stdout: string): Commit[] {
  return parseFullLog(stdout).map((commit) => ({ ...commit, sha: commit.sha.slice(0, 7) }));
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

export interface Revision {
  commit: Commit;
  now: Catalog | undefined;
  before: Catalog | undefined;
}

// blame measured 26% wrong on verbaly-web: a sibling's comma rewrites a line, a value does not
export function attribute(
  revisions: Revision[],
  owners = new Map<string, Commit>(),
): Map<string, Commit> {
  for (const { commit, now, before } of revisions) {
    if (!now || !before) continue;
    for (const key of new Set([...Object.keys(now), ...Object.keys(before)])) {
      if (!owners.has(key) && now[key] !== before[key]) owners.set(key, commit);
    }
  }
  return owners;
}

// a key can move in more than one catalog, so the answer is the newest of the per-file answers
export function mergeOwners(maps: Map<string, Commit>[]): Map<string, Commit> {
  const merged = new Map<string, Commit>();
  for (const map of maps) {
    for (const [key, commit] of map) {
      const held = merged.get(key);
      if (!held || Date.parse(commit.date) > Date.parse(held.date)) merged.set(key, commit);
    }
  }
  return merged;
}

const BLOB = /^[0-9a-f]{40} \w+ (\d+)$/;

// git cat-file --batch answers every revision in one process: a header line, then that many bytes
function readBlobs(
  root: string,
  requests: string[],
  take: (index: number, body: string | null, blob: string) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: root, windowsHide: true });
    // a killed batch leaves a half map, and a half map answers "never committed" for the rest
    const stop = setTimeout(() => {
      ok = false;
      child.kill();
    }, 20000);
    let pending: Buffer = Buffer.alloc(0);
    let index = 0;
    let ok = true;
    const fail = () => {
      ok = false;
    };
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      for (;;) {
        const end = pending.indexOf(10);
        if (end < 0) break;
        const header = pending.toString('utf8', 0, end);
        const blob = BLOB.exec(header);
        // anything but a blob header is a revision git could not resolve, which is an answer too
        if (!blob) {
          take(index++, null, '');
          pending = pending.subarray(end + 1);
          continue;
        }
        const size = Number(blob[1]);
        if (pending.length < end + size + 2) break;
        take(index++, pending.toString('utf8', end + 1, end + 1 + size), header.slice(0, 40));
        pending = pending.subarray(end + size + 2);
      }
    });
    child.on('close', () => {
      clearTimeout(stop);
      resolve(ok);
    });
    child.stdin.end(requests.join('\n') + '\n');
  });
}

export interface KeyHistory {
  owners: Map<string, Commit>;
  committed: Set<string>;
  ok: boolean;
}

// the window a local tool is willing to read: past this, the answer is "older than what I read"
const WINDOW = 200;

async function walkFile(root: string, file: string, limit: number) {
  const { stdout } = await run('git', ['log', `-n${limit}`, FORMAT, '--', file], {
    cwd: root,
    timeout: 5000,
    windowsHide: true,
    maxBuffer: 8_000_000,
  });
  const commits = parseFullLog(stdout);
  if (!commits.length) return { owners: new Map<string, Commit>(), head: [] as string[] };

  const owners = new Map<string, Commit>();
  let head: string[] = [];
  let waiting: Catalog | undefined;
  // only two flat catalogs are ever live, and the pair shares a blob, so one entry caches it
  let last: { blob: string; flat: Catalog | undefined } | null = null;
  const parse = (body: string | null, blob: string): Catalog | undefined => {
    if (body === null) return {};
    if (last && last.blob === blob) return last.flat;
    const flat = parseCatalog(body);
    last = { blob, flat };
    return flat;
  };

  const whole = await readBlobs(
    root,
    commits.flatMap((commit) => [`${commit.sha}:${file}`, `${commit.sha}^:${file}`]),
    (index, body, blob) => {
      const flat = parse(body, blob);
      if (index % 2 === 0) {
        waiting = flat;
        if (index === 0 && flat) head = Object.keys(flat);
        return;
      }
      const commit = commits[(index - 1) / 2];
      if (commit) attribute([{ commit, now: waiting, before: flat }], owners);
      waiting = undefined;
    },
  );
  if (!whole) throw new Error('[verbaly] git could not read every revision of this catalog');
  return { owners, head };
}

// The whole map at once, because a per-key query costs a git process and every row has a menu.
export async function catalogKeyHistory(
  cfg: ResolvedConfig,
  limit = WINDOW,
): Promise<KeyHistory> {
  const maps: Map<string, Commit>[] = [];
  const committed = new Set<string>();
  let ok = false;
  for (const locale of cfg.locales) {
    const file = relative(cfg.root, join(cfg.dir, `${locale}.json`)).replaceAll('\\', '/');
    try {
      const walked = await walkFile(cfg.root, file, limit);
      maps.push(walked.owners);
      for (const key of walked.head) committed.add(key);
      ok = true;
    } catch {
      // one unreadable locale is not the end of the walk: the others still answer for their keys
    }
  }
  return { owners: mergeOwners(maps), committed, ok };
}

export interface KeyCommit {
  key: string;
  commit: Commit | null;
  reason?: 'nogit' | 'uncommitted' | 'older';
}

const walked = new Map<string, { head: string; history: KeyHistory }>();

async function headSha(root: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      timeout: 3000,
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}

// HEAD moving is the only thing that can change an answer, so it is what invalidates the walk
async function keyHistory(cfg: ResolvedConfig): Promise<KeyHistory> {
  const head = await headSha(cfg.root);
  const held = walked.get(cfg.root);
  if (held && held.head === head) return held.history;
  const history = await catalogKeyHistory(cfg);
  walked.set(cfg.root, { head, history });
  return history;
}

export async function keyCommit(cfg: ResolvedConfig, key: string): Promise<KeyCommit> {
  const history = await keyHistory(cfg);
  if (!history.ok) return { key, commit: null, reason: 'nogit' };
  const commit = history.owners.get(key);
  // seven characters is what a person reads and pastes, and the walk needed the full one
  if (commit) return { key, commit: { ...commit, sha: commit.sha.slice(0, 7) } };
  return { key, commit: null, reason: history.committed.has(key) ? 'older' : 'uncommitted' };
}
