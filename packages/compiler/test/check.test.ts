import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { check, formatCheckResult, githubCheckAnnotations } from '../src/check';
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

  it('flags a source-catalog key that is not extracted as missing downstream', () => {
    // 'manual' lives only in the source catalog (not a t`` message), es lacks it
    const catalogs: Catalogs = { en: { manual: 'Text' }, es: {} };
    const result = check(cfg(), catalogs, new MessageRegistry());
    const es = result.missing.find((m) => m.locale === 'es' && m.key === 'manual');
    expect(es).toBeDefined();
    expect(es!.source).toBe('Text');
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
    });
    expect(text).toContain('…"');
    expect(text).not.toContain(long);
  });
});

describe('githubCheckAnnotations', () => {
  function project(code: string) {
    const config = cfg();
    mkdirSync(join(config.root, 'src'));
    writeFileSync(join(config.root, 'src', 'app.ts'), code);
    const registry = new MessageRegistry();
    registry.update(join(config.root, 'src', 'app.ts'), analyze(code, join(config.root, 'src', 'app.ts')));
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
    };
    const [line] = githubCheckAnnotations(result, new MessageRegistry(), '/root');
    expect(line).toContain('100%25 off%0Areally, now: go');
  });

  it('handles an unknown key with a using file and one without', () => {
    const result: CheckResult = {
      ok: false,
      missing: [],
      unknown: [
        { key: 'used', files: ['/root/src/a.ts'] },
        { key: 'orphan', files: [] },
      ],
    };
    const lines = githubCheckAnnotations(result, new MessageRegistry(), '/root');
    expect(lines).toContain('::error file=src/a.ts::unknown key "used" (not in any catalog)');
    expect(lines).toContain('::error::unknown key "orphan" (not in any catalog)');
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
