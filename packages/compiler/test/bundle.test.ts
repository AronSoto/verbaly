import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../src/analyze';
import { auditBundle, clientCatalogs } from '../src/bundle';
import type { Catalogs } from '../src/catalog';
import { resolveConfig, type VerbalyConfig } from '../src/config';
import {
  LOCALE_MODULE_PREFIX,
  RESOLVED_VIRTUAL_ID,
  loadVirtualModule,
  runBuildGate,
} from '../src/plugin';
import { MessageRegistry } from '../src/registry';
import { renderSite } from '../src/render';

const CATALOGS: Catalogs = {
  en: {
    'hero.title': 'Ship it',
    'nav.docs': 'Docs',
    'navbar.x': 'Not nav',
    'notes.v1.title': 'The first one',
    'notes.v1.body': 'What it changed',
    'notes.v2.title': 'The second one',
  },
  es: {
    'hero.title': 'Publícalo',
    'nav.docs': 'Documentación',
    'navbar.x': 'No es nav',
    'notes.v1.title': 'La primera',
    'notes.v1.body': 'Qué cambió',
    'notes.v2.title': 'La segunda',
  },
};

function cfg(overrides: VerbalyConfig = {}) {
  return resolveConfig({ sourceLocale: 'en', locales: ['en', 'es'], ...overrides });
}

function localeModule(config: VerbalyConfig, locale: string): Record<string, string> {
  const code = loadVirtualModule(LOCALE_MODULE_PREFIX + locale, cfg(config), CATALOGS)!;
  return JSON.parse(code.replace('export default ', '').trim().replace(/;$/, '')) as Record<
    string,
    string
  >;
}

describe('clientCatalogs', () => {
  it('drops the whole subtree a prefix names, in every locale', () => {
    const client = clientCatalogs(cfg({ bundle: { exclude: ['notes'] } }), CATALOGS);
    expect(Object.keys(client.en!)).toEqual(['hero.title', 'nav.docs', 'navbar.x']);
    expect(Object.keys(client.es!)).toEqual(['hero.title', 'nav.docs', 'navbar.x']);
  });

  it('matches whole segments, so "nav" never takes "navbar.x" with it', () => {
    const client = clientCatalogs(cfg({ bundle: { exclude: ['nav'] } }), CATALOGS);
    expect(client.en!['nav.docs']).toBeUndefined();
    expect(client.en!['navbar.x']).toBe('Not nav');
  });

  it('takes a nested prefix, leaving its siblings', () => {
    const client = clientCatalogs(cfg({ bundle: { exclude: ['notes.v1'] } }), CATALOGS);
    expect(client.en!['notes.v1.title']).toBeUndefined();
    expect(client.en!['notes.v2.title']).toBe('The second one');
  });

  it('hands back the same object when nothing is excluded', () => {
    expect(clientCatalogs(cfg(), CATALOGS)).toBe(CATALOGS);
  });
});

describe('the emitted client module', () => {
  it('leaves the excluded group out of every locale module', () => {
    const config = { bundle: { exclude: ['notes'] } };
    for (const locale of ['en', 'es']) {
      const messages = localeModule(config, locale);
      expect(Object.keys(messages).some((key) => key.startsWith('notes.'))).toBe(false);
      expect(messages['hero.title']).toBeDefined();
    }
  });

  it('is byte for byte what it was before when no bundle section is written', () => {
    for (const locale of ['en', 'es']) {
      const id = LOCALE_MODULE_PREFIX + locale;
      expect(loadVirtualModule(id, cfg({ bundle: {} }), CATALOGS)).toBe(
        loadVirtualModule(id, cfg(), CATALOGS),
      );
    }
    expect(loadVirtualModule(RESOLVED_VIRTUAL_ID, cfg({ bundle: {} }), CATALOGS)).toBe(
      loadVirtualModule(RESOLVED_VIRTUAL_ID, cfg(), CATALOGS),
    );
  });

  it('stops importing the icu parser when only the excluded group needed it', () => {
    const catalogs: Catalogs = {
      en: { 'a.plain': 'Hi', 'notes.n': '{n, plural, one {#} other {#}}' },
    };
    const config = { sourceLocale: 'en', locales: ['en'] };
    const withNotes = loadVirtualModule(RESOLVED_VIRTUAL_ID, cfg(config), catalogs)!;
    const without = loadVirtualModule(
      RESOLVED_VIRTUAL_ID,
      cfg({ ...config, bundle: { exclude: ['notes'] } }),
      catalogs,
    )!;
    expect(withNotes).toContain('parseIcu');
    expect(without).not.toContain('parseIcu');
  });
});

describe('what bundle.exclude must not touch', () => {
  it('still pre-fills the excluded keys in the mirror: this is the whole point', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-bundle-'));
    const dir = join(root, 'locales');
    mkdirSync(dir, { recursive: true });
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
    }
    const site = join(root, 'dist');
    mkdirSync(site, { recursive: true });
    writeFileSync(
      join(site, 'index.html'),
      '<html><body><h1 data-verbaly="notes.v1.title">The first one</h1></body></html>',
    );

    const config = resolveConfig({
      root,
      sourceLocale: 'en',
      locales: ['en', 'es'],
      bundle: { exclude: ['notes'] },
    });
    const result = await renderSite(config, { site: 'dist' });

    expect(result.missing).toEqual({});
    expect(readFileSync(join(site, 'es', 'index.html'), 'utf8')).toContain('>La primera<');
  });

  it('does not report an excluded key as missing: the gate reads the catalogs from disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-gate-'));
    const dir = join(root, 'locales');
    mkdirSync(dir, { recursive: true });
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
    }
    const config = resolveConfig({
      root,
      sourceLocale: 'en',
      locales: ['en', 'es'],
      bundle: { exclude: ['notes'] },
    });
    expect(() => runBuildGate(config, new MessageRegistry())).not.toThrow();
  });
});

describe('auditBundle', () => {
  it('says so when a prefix matches nothing, because that is a typo', () => {
    const issues = auditBundle(
      cfg({ bundle: { exclude: ['note'] } }),
      CATALOGS,
      new MessageRegistry(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.problem).toContain('matches no key');
  });

  it('says so when code reads an excluded key through t()', () => {
    const registry = new MessageRegistry();
    registry.update('src/app.ts', analyze("t('notes.v1.title');", 'src/app.ts'));
    const issues = auditBundle(cfg({ bundle: { exclude: ['notes'] } }), CATALOGS, registry);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.problem).toContain('is read by t() in 1 file');
  });

  it('stays quiet on a prefix that exists and that no code reads', () => {
    expect(
      auditBundle(cfg({ bundle: { exclude: ['notes'] } }), CATALOGS, new MessageRegistry()),
    ).toEqual([]);
  });

  it('stays quiet with no bundle section at all', () => {
    const registry = new MessageRegistry();
    registry.update('src/app.ts', analyze("t('notes.v1.title');", 'src/app.ts'));
    expect(auditBundle(cfg(), CATALOGS, registry)).toEqual([]);
  });

  it('reaches the build gate as a warning, never as a failure', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const root = mkdtempSync(join(tmpdir(), 'verbaly-audit-'));
    const dir = join(root, 'locales');
    mkdirSync(dir, { recursive: true });
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      writeFileSync(join(dir, `${locale}.json`), JSON.stringify(catalog));
    }
    const config = resolveConfig({
      root,
      sourceLocale: 'en',
      locales: ['en', 'es'],
      bundle: { exclude: ['typo_group'] },
    });
    expect(() => runBuildGate(config, new MessageRegistry())).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('typo_group'));
    warn.mockRestore();
  });
});
