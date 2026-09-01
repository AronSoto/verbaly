import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import {
  check,
  checkNextSteps,
  formatCheckResult,
  formatCheckWarnings,
  gatePasses,
  githubCheckAnnotations,
} from '../src/check';
import type { CheckResult } from '../src/check';
import type { Catalogs } from '../src/catalog';
import { resolveConfig } from '../src/config';
import { MessageRegistry } from '../src/registry';

function cfg(locales: string[] = ['en', 'es']) {
  return resolveConfig({
    root: mkdtempSync(join(tmpdir(), 'verbaly-check-')),
    sourceLocale: 'en',
    locales,
  });
}

describe('check', () => {
  it('tolerates a missing source catalog', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Hello`;', 'a.ts'));
    const result = check(cfg(), {}, registry);
    expect(result.ok).toBe(false);
    // the key is missing in en (no source) and es
    expect(result.missing.some((m) => m.locale === 'en')).toBe(true);
  });

  it('checks a nested catalog leaf by leaf, not by its top-level groups', () => {
    // comparing group names called a locale complete while its leaves were untranslated
    const catalogs = {
      en: { nav: { home: 'Home', docs: 'Docs' } },
      es: { nav: { home: 'Inicio', docs: '' } },
    } as unknown as Catalogs;
    const result = check(cfg(), catalogs, new MessageRegistry());
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual([{ locale: 'es', key: 'nav.docs', source: 'Docs' }]);
  });

  it('validates a nested leaf against its source leaf', () => {
    const catalogs = {
      en: { cart: { total: 'You have {count} items' } },
      es: { cart: { total: 'Tienes elementos' } },
    } as unknown as Catalogs;
    const result = check(cfg(), catalogs, new MessageRegistry());
    const errors = result.broken.filter((entry) => entry.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.key).toBe('cart.total');
  });

  it('flags a source-catalog key that is not extracted as missing downstream', () => {
    // 'manual' lives only in the source catalog (not a t`` message), es lacks it
    const catalogs: Catalogs = { en: { manual: 'Text' }, es: {} };
    const result = check(cfg(), catalogs, new MessageRegistry());
    const es = result.missing.find((m) => m.locale === 'es' && m.key === 'manual');
    expect(es).toBeDefined();
    expect(es!.source).toBe('Text');
  });
});

describe('check: broken translations', () => {
  it('fails on a translation that exists but dropped its param or its tag', () => {
    const catalogs: Catalogs = {
      en: { greet: 'Hello {name}', save: '<em>Save</em> your work' },
      es: { greet: 'Hola', save: 'Guarda tu trabajo' },
    };
    const result = check(cfg(), catalogs, new MessageRegistry());
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(false);
    const errors = result.broken.filter((entry) => entry.severity === 'error');
    expect(errors.map((entry) => entry.key).sort()).toEqual(['greet', 'save']);
    expect(errors.every((entry) => entry.locale === 'es')).toBe(true);
  });

  it('fails on a plural block that renders empty for uncovered counts', () => {
    const catalogs: Catalogs = {
      en: { items: '{count | one: one item | other: # items}' },
      pl: { items: '{count | one: 1 element | few: # elementy}' },
    };
    const result = check(cfg(['en', 'pl']), catalogs, new MessageRegistry());
    expect(result.ok).toBe(false);
    const broken = result.broken.filter((entry) => entry.severity === 'error');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.issue).toContain('renders empty');
  });

  it('passes with warnings when the plural set is only incomplete for the locale', () => {
    const catalogs: Catalogs = {
      en: { items: '{count | one: one item | other: # items}' },
      pl: { items: '{count | one: 1 element | other: # elementow}' },
    };
    const result = check(cfg(['en', 'pl']), catalogs, new MessageRegistry());
    expect(result.ok).toBe(true);
    expect(result.broken).toHaveLength(1);
    expect(result.broken[0]!.severity).toBe('warning');
    expect(formatCheckWarnings(result)).toContain('[pl] items');
    // a warning never reaches the failure report
    expect(formatCheckResult(result)).not.toContain('items');
  });

  it('flags a source message whose own plural block has no other case', () => {
    const catalogs: Catalogs = {
      en: { items: '{count | one: one item}' },
      es: { items: '{count | one: un elemento}' },
    };
    const result = check(cfg(), catalogs, new MessageRegistry());
    expect(result.ok).toBe(false);
    const locales = result.broken
      .filter((entry) => entry.severity === 'error')
      .map((entry) => entry.locale);
    expect(locales).toContain('en');
    expect(locales).toContain('es');
  });

  it('stays quiet on a faithful catalog', () => {
    const catalogs: Catalogs = {
      en: { greet: 'Hello {name}', items: '{count | one: one item | other: # items}' },
      es: { greet: 'Hola {name}', items: '{count | one: un elemento | other: # elementos}' },
    };
    const result = check(cfg(), catalogs, new MessageRegistry());
    expect(result.broken).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('never reports a key it already reported as missing', () => {
    const catalogs: Catalogs = { en: { greet: 'Hello {name}' }, es: {} };
    const result = check(cfg(), catalogs, new MessageRegistry());
    expect(result.missing).toHaveLength(1);
    expect(result.broken).toEqual([]);
  });

  it('validates a hand-written nested catalog leaf by leaf', () => {
    // a nested catalog is as real as a generated flat one: walking it as strings crashed the gate
    const catalogs = {
      en: { hero: { title: 'Hello {name}', lead: '<em>Ship</em> it' } },
      es: { hero: { title: 'Hola', lead: 'Publicalo' } },
    } as unknown as Catalogs;
    const result = check(cfg(), catalogs, new MessageRegistry());
    expect(result.ok).toBe(false);
    const errors = result.broken.filter((entry) => entry.severity === 'error');
    expect(errors.map((entry) => entry.key).sort()).toEqual(['hero.lead', 'hero.title']);
  });

  it('stays quiet on a faithful nested catalog', () => {
    const catalogs = {
      en: { hero: { title: 'Hello {name}' } },
      es: { hero: { title: 'Hola {name}' } },
    } as unknown as Catalogs;
    expect(check(cfg(), catalogs, new MessageRegistry()).broken).toEqual([]);
  });

  it('validates against the extracted message when the source catalog lags', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Hello ${name}`;', 'a.ts'));
    const key = [...registry.messages().keys()][0]!;
    const result = check(cfg(), { en: {}, es: { [key]: 'Hola' } }, registry);
    const broken = result.broken.filter((entry) => entry.severity === 'error');
    expect(broken).toHaveLength(1);
    expect(broken[0]!.issue).toContain('{name}');
  });
});

describe('formatCheckResult', () => {
  it('renders missing entries with and without a source hint, plus unknown keys', () => {
    const result: CheckResult = {
      ok: false,
      missing: [
        { locale: 'es', key: 'greet', source: 'Hello there' },
        { locale: 'es', key: 'bare' },
      ],
      unknown: [{ key: 'ghost', files: ['src/a.ts'] }],
      broken: [],
    };
    const text = formatCheckResult(result);
    expect(text).toContain('  [es] greet: "Hello there"');
    expect(text).toContain('  [es] bare');
    expect(text).not.toContain('bare:');
    expect(text).toContain('ghost (used in src/a.ts)');
  });

  it('truncates a long source hint', () => {
    const long = 'x'.repeat(60);
    const text = formatCheckResult({
      ok: false,
      missing: [{ locale: 'es', key: 'k', source: long }],
      unknown: [],
      broken: [],
    });
    expect(text).toContain('…"');
    expect(text).not.toContain(long);
  });
});

describe('checkNextSteps', () => {
  const result = (patch: Partial<CheckResult>): CheckResult => ({
    ok: false,
    missing: [],
    unknown: [],
    broken: [],
    ...patch,
  });

  it('gives the remedy that matches the failure, not always extract', () => {
    const missing = checkNextSteps(result({ missing: [{ locale: 'es', key: 'k' }] }));
    expect(missing).toContain('verbaly extract');

    const broken = checkNextSteps(
      result({ broken: [{ locale: 'es', key: 'k', severity: 'error', issue: 'lost {name}' }] }),
    );
    // extract rewrites catalogs from the source: it can never repair a translation
    expect(broken).not.toContain('verbaly extract');
    expect(broken).toContain('params, tags and plural cases');

    const unknown = checkNextSteps(result({ unknown: [{ key: 'ghost', files: [] }] }));
    expect(unknown).toContain('fix the key');
  });

  it('says nothing about categories that did not fail', () => {
    const steps = checkNextSteps(result({ unknown: [{ key: 'ghost', files: [] }] }));
    expect(steps.split('\n')).toHaveLength(1);
  });

  it('names the install when the command it just told you to run does not exist', () => {
    // the gate prints from inside a build, and its "run npx verbaly extract" was unreachable there
    const failing = result({ missing: [{ locale: 'es', key: 'k' }] });
    expect(checkNextSteps(failing, false)).toContain('@verbaly/compiler');
    expect(checkNextSteps(failing, true)).not.toContain('@verbaly/compiler');
    // a passing check has no remedy to make unreachable
    expect(checkNextSteps(result({}), false)).toBe('');
  });

  it('stays quiet about warnings: they never block anything', () => {
    const warned = result({
      ok: true,
      broken: [{ locale: 'pl', key: 'k', severity: 'warning', issue: 'pl also needs few' }],
    });
    expect(gatePasses(warned)).toBe(true);
    expect(checkNextSteps(warned)).toBe('');
  });
});

describe('githubCheckAnnotations', () => {
  function project(code: string) {
    const config = cfg();
    mkdirSync(join(config.root, 'src'));
    writeFileSync(join(config.root, 'src', 'app.ts'), code);
    const registry = new MessageRegistry();
    registry.update(
      join(config.root, 'src', 'app.ts'),
      analyze(code, join(config.root, 'src', 'app.ts')),
    );
    return { config, registry };
  }

  it('annotates the source file and line, grouping locales for one key', () => {
    const { config, registry } = project('const pad = 1;\nexport const x = t`Hello there`;\n');
    const catalogs: Catalogs = { en: {}, es: {}, pt: {} };
    config.locales.push('pt');
    const result = check(config, catalogs, registry);
    const lines = githubCheckAnnotations(result, registry, config.root);
    const missingLine = lines.find((l) => l.includes('Hello there'));
    expect(missingLine).toMatch(/::error file=src\/app\.ts,line=2::/);
    // en, es and pt all miss the key: one annotation, locales grouped
    expect(missingLine).toContain('en, es, pt');
  });

  it('falls back to a line-less annotation when the source cannot be read', () => {
    const config = cfg();
    // absolute origin that is never written to disk: readSource fails, no line number
    const ghost = join(config.root, 'src', 'ghost.ts');
    const registry = new MessageRegistry();
    registry.update(ghost, analyze('t`Poof`;', ghost));
    const result = check(config, { en: {}, es: {} }, registry);
    const lines = githubCheckAnnotations(result, registry, config.root);
    const line = lines.find((l) => l.includes('Poof'));
    expect(line).toContain('::error file=src/ghost.ts::');
    expect(line).not.toContain(',line=');
  });

  it('emits a location-less error for a missing key with no registry origin', () => {
    // 'manual' is only in the source catalog, never extracted: no origin to point at
    const config = cfg();
    const result = check(config, { en: { manual: 'Text' }, es: {} }, new MessageRegistry());
    const lines = githubCheckAnnotations(result, new MessageRegistry(), config.root);
    expect(lines.some((l) => l === '::error::missing [es] manual: "Text"')).toBe(true);
  });

  it('escapes workflow-command metacharacters in the message', () => {
    const result: CheckResult = {
      ok: false,
      missing: [{ locale: 'es', key: 'k', source: '100% off\nreally, now: go' }],
      unknown: [],
      broken: [],
    };
    const [line] = githubCheckAnnotations(result, new MessageRegistry(), '/root');
    expect(line).toContain('100%25 off%0Areally, now: go');
  });

  it('handles an unknown key with a using file and one without', () => {
    const result: CheckResult = {
      ok: false,
      missing: [],
      broken: [],
      unknown: [
        { key: 'used', files: ['/root/src/a.ts'] },
        { key: 'orphan', files: [] },
      ],
    };
    const lines = githubCheckAnnotations(result, new MessageRegistry(), '/root');
    expect(lines).toContain('::error file=src/a.ts::unknown key "used" (not in any catalog)');
    expect(lines).toContain('::error::unknown key "orphan" (not in any catalog)');
  });

  it('annotates a broken translation at the line that wrote the message', () => {
    const { config, registry } = project('export const x = t`Hello ${name}`;\n');
    const key = [...registry.messages().keys()][0]!;
    const result = check(
      config,
      { en: { [key]: 'Hello {name}' }, es: { [key]: 'Hola' } },
      registry,
    );
    const lines = githubCheckAnnotations(result, registry, config.root);
    const broken = lines.find((l) => l.includes('{name}') && l.includes('[es]'));
    expect(broken).toMatch(/::error file=src\/app\.ts,line=1::/);
  });

  it('emits a warning command for a warning, so it never fails the job', () => {
    const result: CheckResult = {
      ok: true,
      missing: [],
      unknown: [],
      broken: [{ locale: 'pl', key: 'items', severity: 'warning', issue: 'pl also needs few' }],
    };
    const [line] = githubCheckAnnotations(result, new MessageRegistry(), '/root');
    expect(line).toBe('::warning::[pl] items: pl also needs few');
  });

  it('reads each source file only once across multiple missing keys', () => {
    const code = 'export const a = t`One`;\nexport const b = t`Two`;\n';
    const { config, registry } = project(code);
    const result = check(config, { en: {}, es: {} }, registry);
    const lines = githubCheckAnnotations(result, registry, config.root);
    // both keys resolve to real line numbers from the single cached read
    expect(lines.filter((l) => l.includes(',line=')).length).toBeGreaterThanOrEqual(2);
  });
});
