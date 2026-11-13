import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gatePasses, type CheckResult } from '../src/gate/check';
import {
  checkNextSteps,
  formatBuildReport,
  formatCheckResult,
  githubCheckAnnotations,
} from '../src/gate/report';
import { resolveConfig } from '../src/config/config';
import { MessageRegistry } from '../src/scan/registry';

const root = mkdtempSync(join(tmpdir(), 'verbaly-gate-reach-'));
const cfg = resolveConfig({ root, sourceLocale: 'en', locales: ['en', 'es'] });
const site = { file: join(root, 'src', 'a.ts'), line: 3, message: 'Hi' };

type Lists = Omit<CheckResult, 'ok'>;

// one entry per list of a check result: a new list has to bring one, or this file fails to compile
const SAMPLE: { [K in keyof Lists]: Lists[K][number] } = {
  missing: { locale: 'es', key: 'reach.missing', source: 'Hi' },
  unknown: { key: 'reach.unknown', files: [site.file] },
  broken: { locale: 'es', key: 'reach.broken', severity: 'error', issue: 'loses {name}' },
  extra: { locale: 'es', key: 'reach.extra', files: [] },
  collisions: { key: 'reach.collision', sites: [site, { ...site, line: 9, message: 'Hello' }] },
  divergent: { key: 'reach.divergent', catalog: 'Hey', code: site },
  outdated: { locale: 'es', key: 'reach.outdated' },
};

const EMPTY: Lists = {
  missing: [],
  unknown: [],
  broken: [],
  extra: [],
  collisions: [],
  divergent: [],
  outdated: [],
};

const only = (list: keyof Lists): CheckResult => {
  const lists = { ...EMPTY, [list]: [SAMPLE[list]] } as Lists;
  return { ok: gatePasses(lists), ...lists };
};

// which lists fail is gatePasses' answer, read from it: nobody keeps a second list by hand
const failing = (Object.keys(SAMPLE) as (keyof Lists)[]).filter((list) => !only(list).ok);

describe('a category that fails the gate reaches every report of it', () => {
  it('finds the failing categories in gatePasses itself', () => {
    expect(failing).toEqual(['missing', 'unknown', 'broken', 'collisions']);
  });

  for (const list of failing) {
    it(`says ${list} in check, the build report, the next steps and the PR annotations`, () => {
      const result = only(list);
      const key = list === 'collisions' ? SAMPLE.collisions.key : SAMPLE[list].key;
      expect(formatCheckResult(result, root), 'check').toContain(key);
      expect(formatBuildReport(result, 'en', root).join('\n'), 'the build report').not.toBe('');
      expect(checkNextSteps(result), 'the next steps').not.toBe('');
      const annotations = githubCheckAnnotations(result, new MessageRegistry(), cfg);
      expect(annotations.filter((line) => line.startsWith('::error')).join('\n')).toContain(key);
    });
  }
});
