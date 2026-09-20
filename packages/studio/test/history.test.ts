import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@verbaly/compiler';
import { describe, expect, it } from 'vitest';
import { catalogHistory, parseLog } from '../src/history';

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
