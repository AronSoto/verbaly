import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config/config';
import { createDevReporter, type DevSync, type Finding } from '../src/gate/findings';
import { stableKey } from '../src/util/key';

const cfg = resolveConfig({
  root: mkdtempSync(join(tmpdir(), 'verbaly-reporter-')),
  locales: ['es'],
  include: [],
});
const site = { file: join(cfg.root, 'src', 'app.ts'), line: 2, message: 'Hello' };
const replaced: Finding = { kind: 'replaced', locale: 'en', key: 'greet', before: 'Hi', site };
const stamp = (source: string, translated: string): string =>
  `${stableKey(source)}.${stableKey(translated)}`;

function reporter() {
  const lines: string[] = [];
  return { lines, dev: createDevReporter(cfg.root, (line) => lines.push(line)) };
}

const result = (more: Partial<DevSync> = {}): DevSync => ({
  findings: [],
  catalogs: { en: { bio: 'I write code.' }, es: { bio: 'Escribo código' } },
  ...more,
});

describe('DevReporter.sync: everything one dev write-back says', () => {
  it('says a text the code wrote over as the caller judged it, and drops one it does not vouch for', () => {
    const { lines, dev } = reporter();
    dev.sync(cfg, result({ findings: [replaced] }), () => undefined);
    expect(lines).toEqual([]);
    dev.sync(cfg, result({ findings: [replaced] }), () => true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('greet');
    // the same finding on the next write-back is not news
    dev.sync(cfg, result({ findings: [replaced] }), () => true);
    expect(lines).toHaveLength(1);
  });

  it('words an edit in the catalog apart from a first sight of the difference', () => {
    const first = reporter();
    first.dev.sync(cfg, result({ findings: [replaced] }), () => false);
    const edit = reporter();
    edit.dev.sync(cfg, result({ findings: [replaced] }), () => true);
    expect(first.lines[0]).not.toBe(edit.lines[0]);
  });

  it('says a collision, a t under another name and the lock, each once', () => {
    const { lines, dev } = reporter();
    const findings: Finding[] = [
      { kind: 'collision', key: 'k', sites: [site, { ...site, line: 9, message: 'Other' }] },
      { kind: 'renamed', name: 'tr', file: site.file, line: 4 },
      { kind: 'lock', file: join(cfg.root, 'verbaly.lock') },
    ];
    dev.sync(cfg, result({ findings }), () => undefined);
    dev.sync(cfg, result({ findings }), () => undefined);
    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).toContain('verbaly.lock');
  });

  it('says the translations written for an older source text, from the state the run saved', () => {
    const { lines, dev } = reporter();
    const state = {
      drafts: {},
      fingerprints: { es: { bio: stamp('I write code', 'Escribo código') } },
    };
    dev.sync(cfg, result({ state }), () => undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('bio');
    // without a state there is nothing to compare, and nothing is said
    const quiet = reporter();
    quiet.dev.sync(cfg, result(), () => undefined);
    expect(quiet.lines).toEqual([]);
  });

  it('says a lock it could not read once while it lasts, and again if it breaks after a fix', () => {
    const { lines, dev } = reporter();
    const broken = result({ stateProblem: 'verbaly.lock is not valid JSON' });
    dev.sync(cfg, broken, () => undefined);
    dev.sync(cfg, broken, () => undefined);
    expect(lines).toEqual(['verbaly.lock is not valid JSON, so drafts are not tracked']);
    dev.sync(cfg, result(), () => undefined);
    dev.sync(cfg, broken, () => undefined);
    expect(lines).toHaveLength(2);
  });
});
