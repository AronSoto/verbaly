import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadCatalogs } from '../src/catalog/catalog';
import { check, gatePasses, type CheckResult } from '../src/gate/check';
import {
  checkNextSteps,
  formatBuildReport,
  formatCheckResult,
  githubCheckAnnotations,
} from '../src/gate/report';
import { resolveConfig, type ResolvedConfig } from '../src/config/config';
import { runBuildGate } from '../src/emit/plugin';
import { doctor } from '../src/project/doctor';
import { extractProject } from '../src/scan/extract';
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

interface Project {
  code: string;
  en: Record<string, string>;
  es: Record<string, string>;
}

const HEALTHY: Project = {
  code: "t('reach.greet', { name });\n",
  en: { 'reach.greet': 'Hi {name}' },
  es: { 'reach.greet': 'Hola {name}' },
};

// a real project per failing list: doctor and a build read the disk, so a sample is not enough
const BROKEN: Partial<Record<keyof Lists, Project>> = {
  missing: { ...HEALTHY, es: { 'reach.greet': '' } },
  unknown: { ...HEALTHY, code: `${HEALTHY.code}t('reach.nowhere');\n` },
  broken: { ...HEALTHY, es: { 'reach.greet': 'Hola' } },
  collisions: {
    code: "t.id('reach.greet')`Hi ${name}`;\nt.id('reach.greet')`Hello ${name}`;\n",
    en: HEALTHY.en,
    es: HEALTHY.es,
  },
};

function onDisk(project: Project): ResolvedConfig {
  const dir = mkdtempSync(join(tmpdir(), 'verbaly-gate-reach-'));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'locales'));
  writeFileSync(join(dir, 'src', 'app.ts'), project.code);
  writeFileSync(join(dir, 'locales', 'en.json'), JSON.stringify(project.en));
  writeFileSync(join(dir, 'locales', 'es.json'), JSON.stringify(project.es));
  return resolveConfig({ root: dir, sourceLocale: 'en', locales: ['en', 'es'] });
}

// what doctor holds against a project, without its words: the level and the check that said it
const complaints = async (project: Project): Promise<string[]> =>
  (await doctor(onDisk(project))).entries
    .filter((entry) => entry.level !== 'ok')
    .map((entry) => `${entry.level} ${entry.check}`);

describe('a category that fails the gate reaches doctor and the memory of a build', () => {
  for (const list of failing) {
    it(`has a project that fails on ${list} alone`, async () => {
      const project = BROKEN[list];
      expect(project, `a project in BROKEN that fails on ${list}`).toBeDefined();
      const made = onDisk(project!);
      const found = check(made, loadCatalogs(made), await extractProject(made));
      expect(failing.filter((other) => !gatePasses({ ...EMPTY, [other]: found[other] }))).toEqual([
        list,
      ]);
    });

    it(`makes doctor say ${list}, which a healthy project does not hear`, async () => {
      const healthy = await complaints(HEALTHY);
      const said = await complaints(BROKEN[list]!);
      expect(said.filter((line) => !healthy.includes(line))).not.toEqual([]);
    });

    it(`says ${list} in one build and not again in the next`, async () => {
      const made = onDisk(BROKEN[list]!);
      const registry = await extractProject(made);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        runBuildGate(made, registry);
        expect(warn.mock.calls.flat().join('\n'), 'the first build').toContain('reach.');
        warn.mockClear();
        runBuildGate(made, registry);
        expect(warn.mock.calls.flat().join('\n'), 'the second build').toBe('');
      } finally {
        warn.mockRestore();
      }
    });
  }
});
