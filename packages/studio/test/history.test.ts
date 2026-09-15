import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '@verbaly/compiler';
import { beforeAll, describe, expect, it } from 'vitest';
import { catalogHistory } from '../src/history';

const git = (root: string, ...args: string[]): void => {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
};

function bare() {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-hist-'));
  mkdirSync(join(root, 'locales'), { recursive: true });
  writeFileSync(join(root, 'locales', 'en.json'), '{"a":"1"}');
  return root;
}

let repo: string;

beforeAll(() => {
  repo = bare();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test Person');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'feat: the first catalog');

  writeFileSync(join(repo, 'README.md'), 'not a catalog');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'docs: nothing to do with catalogs');

  writeFileSync(join(repo, 'locales', 'en.json'), '{"a":"1","b":"2"}');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'feat: a second message');
}, 30000);

describe('the history of your catalogs comes from git', () => {
  // Proved able to fail by asking git for the whole repo: the README commit comes back too.
  it('lists only the commits that touched the catalog directory, newest first', async () => {
    const cfg = resolveConfig({ root: repo, sourceLocale: 'en' });
    const commits = await catalogHistory(cfg);
    expect(commits.map((c) => c.subject)).toEqual([
      'feat: a second message',
      'feat: the first catalog',
    ]);
  });

  it('reports the author, a short sha and a date that parses', async () => {
    const cfg = resolveConfig({ root: repo, sourceLocale: 'en' });
    const [first] = await catalogHistory(cfg);
    expect(first!.author).toBe('Test Person');
    expect(first!.sha).toHaveLength(7);
    expect(Number.isNaN(Date.parse(first!.date))).toBe(false);
  });

  it('honours the limit, because the card shows a few and not a log', async () => {
    const cfg = resolveConfig({ root: repo, sourceLocale: 'en' });
    expect(await catalogHistory(cfg, 1)).toHaveLength(1);
  });

  // Proved able to fail by letting the error out: a project without git would take the route down
  it('answers with nothing outside a repository, instead of failing', async () => {
    const cfg = resolveConfig({ root: bare(), sourceLocale: 'en' });
    expect(await catalogHistory(cfg)).toEqual([]);
  });
});
