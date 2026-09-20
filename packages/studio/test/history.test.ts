import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@verbaly/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attribute, catalogHistory, keyCommit, mergeOwners, parseLog, type Commit } from '../src/history';

const FIELD = '\u001f';
const line = (sha: string, author: string, date: string, subject: string): string =>
  [sha, author, date, subject].join(FIELD);

// this repository, read only: git log never writes, so no test here creates a commit
const repo = join(import.meta.dirname, '..', '..', '..');

function project(dir: string) {
  return resolveConfig({ root: repo, dir, sourceLocale: 'en', locales: ['en'] });
}

describe('a log line, which is where the parsing can go wrong', () => {
  // Proved able to fail by splitting on the wrong field: the subject comes back truncated.
  it('reads the four fields and shortens the sha to seven', () => {
    const out = parseLog(line('0123456789abcdef', 'Aron Soto', '2026-09-15T10:00:00+02:00', 'feat: x'));
    expect(out).toEqual([
      { sha: '0123456', author: 'Aron Soto', date: '2026-09-15T10:00:00+02:00', subject: 'feat: x' },
    ]);
  });

  it('keeps a subject that holds a colon, a comma or a separator of its own', () => {
    const odd = `fix: a, b${FIELD}c`;
    expect(parseLog(line('abc1234', 'A', '2026-01-01T00:00:00Z', odd))[0]!.subject).toBe(odd);
  });

  it('skips the blank trailing line git always writes', () => {
    const stdout = `${line('abc1234', 'A', '2026-01-01T00:00:00Z', 'one')}\n`;
    expect(parseLog(stdout)).toHaveLength(1);
  });

  // Proved able to fail by dropping the rest.length guard: a half line becomes a commit.
  it('skips a line that is not a full record', () => {
    expect(parseLog('garbage')).toEqual([]);
    expect(parseLog(`abc${FIELD}A${FIELD}2026-01-01T00:00:00Z`)).toEqual([]);
  });
});

describe('the command, against this repository and without writing to it', () => {
  it('answers with real commits for a directory that has them', async () => {
    const commits = await catalogHistory(project(join(repo, 'packages', 'studio')), 3);
    expect(commits.length).toBeGreaterThan(0);
    expect(commits[0]!.sha).toHaveLength(7);
    expect(Number.isNaN(Date.parse(commits[0]!.date))).toBe(false);
    expect(commits[0]!.author).toBeTruthy();
  });

  // Proved able to fail by dropping the `--` pathspec: a release commit touches every directory.
  it('asks only about the directory it was given', async () => {
    const real = await catalogHistory(project(join(repo, 'packages', 'studio')), 3);
    const none = await catalogHistory(project(join(repo, 'packages', 'no-such-directory')), 3);
    expect(real.length).toBeGreaterThan(0);
    expect(none).toEqual([]);
  });

  it('honours the limit, because the card shows a few and not a log', async () => {
    expect(await catalogHistory(project(join(repo, 'packages')), 1)).toHaveLength(1);
  });

  // Proved able to fail by letting the error out: a project without git would take the route down
  it('answers with nothing outside a repository, instead of failing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-nogit-'));
    mkdirSync(join(root, 'locales'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), '{}');
    const cfg = resolveConfig({ root, sourceLocale: 'en' });
    expect(await catalogHistory(cfg)).toEqual([]);
  });
});

const commit = (sha: string, date: string, subject = 'x'): Commit => ({
  sha,
  author: 'A',
  date,
  subject,
});

describe('which commit changed a key, which is a question about values and not about lines', () => {
  // The pin. Proved able to fail by comparing texts: a sibling rewrites the line before it.
  it('leaves a key alone when the commit only added a sibling next to it', () => {
    const owners = attribute([
      {
        commit: commit('aaa', '2026-09-02T00:00:00Z', 'add b'),
        now: { a: 'one', b: 'two' },
        before: { a: 'one' },
      },
      {
        commit: commit('bbb', '2026-09-01T00:00:00Z', 'write a'),
        now: { a: 'one' },
        before: {},
      },
    ]);
    expect(owners.get('a')!.subject).toBe('write a');
    expect(owners.get('b')!.subject).toBe('add b');
  });

  it('keeps the newest answer, because the walk runs newest first', () => {
    const owners = attribute([
      { commit: commit('new', '2026-09-02T00:00:00Z', 'newest'), now: { a: '2' }, before: { a: '1' } },
      { commit: commit('old', '2026-09-01T00:00:00Z', 'older'), now: { a: '1' }, before: {} },
    ]);
    expect(owners.get('a')!.subject).toBe('newest');
  });

  it('counts a key that was removed, because that is the commit that touched it', () => {
    const owners = attribute([
      { commit: commit('del', '2026-09-02T00:00:00Z', 'drop a'), now: {}, before: { a: '1' } },
    ]);
    expect(owners.get('a')!.subject).toBe('drop a');
  });

  // Proved able to fail by treating an unreadable blob as an empty catalog: every key moves to it.
  it('attributes nothing for a revision nobody could parse, instead of everything', () => {
    const owners = attribute([
      { commit: commit('bad', '2026-09-02T00:00:00Z', 'broken json'), now: undefined, before: { a: '1' } },
      { commit: commit('ok', '2026-09-01T00:00:00Z', 'write a'), now: { a: '1' }, before: {} },
    ]);
    expect(owners.get('a')!.subject).toBe('write a');
  });

  // Proved able to fail by letting the first map win: a later locale edit would read stale.
  it('takes the newest of the per-catalog answers, because a key lives in every language', () => {
    const merged = mergeOwners([
      new Map([['a', commit('en', '2026-09-01T00:00:00Z', 'english')]]),
      new Map([['a', commit('es', '2026-09-05T00:00:00Z', 'spanish')]]),
      new Map([['a', commit('pt', '2026-09-03T00:00:00Z', 'portuguese')]]),
    ]);
    expect(merged.get('a')!.subject).toBe('spanish');
  });
});

describe('keyCommit, against this repository and without writing to it', () => {
  // package.json is a committed JSON file with a real history, which is all the walk asks for
  const asCatalog = () =>
    resolveConfig({
      root: repo,
      dir: join('packages', 'studio'),
      sourceLocale: 'package',
      locales: ['package'],
    });

  beforeEach(() => {
    // flatten warns on a leaf that is not text, and package.json has arrays: not the subject
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names a commit that really changed that key, checked with a different git command', async () => {
    const answer = await keyCommit(asCatalog(), 'name');
    expect(answer.commit).not.toBeNull();
    expect(answer.commit!.sha).toHaveLength(7);
    // a revision where the file is not there yet is undefined, which is how the walk reads it too
    const at = (rev: string): string | undefined => {
      try {
        const show = execFileSync('git', ['show', rev + ':packages/studio/package.json'], {
          cwd: repo,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return JSON.parse(show).name;
      } catch {
        return undefined;
      }
    };
    expect(at(answer.commit!.sha)).not.toBe(at(`${answer.commit!.sha}^`));
  });

  // three facts, three answers: a null with no reason would make them look like the same thing
  it('says a key no commit ever held was never committed', async () => {
    const answer = await keyCommit(asCatalog(), 'no.such.key.anywhere');
    expect(answer.commit).toBeNull();
    expect(answer.reason).toBe('uncommitted');
  });

  it('says so when there is no repository, instead of answering with nothing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-nogit-key-'));
    mkdirSync(join(root, 'locales'), { recursive: true });
    writeFileSync(join(root, 'locales', 'en.json'), '{"a":"b"}');
    const answer = await keyCommit(resolveConfig({ root, sourceLocale: 'en' }), 'a');
    expect(answer.commit).toBeNull();
    expect(answer.reason).toBe('nogit');
  });
});
