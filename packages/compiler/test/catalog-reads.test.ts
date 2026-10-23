import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flatten } from 'verbaly';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyze } from '../src/analyze';
import { emptyCatalog, needsIcu, needsRelative, type Catalogs } from '../src/catalog';
import { check } from '../src/check';
import { resolveConfig } from '../src/config';
import { shippedCatalogs } from '../src/extract';
import { MessageRegistry } from '../src/registry';
import { status } from '../src/status';

// the core's flatten, counted: copying a catalog readCatalog already flattened is the whole cost
vi.mock('verbaly', async (importOriginal) => {
  const core = await importOriginal<typeof import('verbaly')>();
  return { ...core, flatten: vi.fn(core.flatten) };
});

const cfg = resolveConfig({
  root: mkdtempSync(join(tmpdir(), 'verbaly-catalog-reads-')),
  sourceLocale: 'en',
  locales: ['en', 'es'],
});

// the shape readCatalog hands every reader: flat, and with no prototype
const asRead = (entries: Record<string, string>) => Object.assign(emptyCatalog(), entries);

const read = (): Catalogs => ({
  en: asRead({ hi: 'Hi {name}', when: 'Seen {at:relative}' }),
  es: asRead({ hi: 'Hola {name}', when: 'Visto {at:relative}' }),
});

beforeEach(() => {
  vi.mocked(flatten).mockClear();
});

describe('a catalog that is already flat is read where it is', () => {
  it('the detectors of the generated module walk it without copying it', () => {
    const catalogs = read();
    expect(needsIcu(catalogs)).toBe(false);
    expect(needsRelative(catalogs)).toBe(true);
    expect(vi.mocked(flatten)).not.toHaveBeenCalled();
  });

  it('check and status copy only the source, the one catalog the code writes into', () => {
    const catalogs = read();
    check(cfg, catalogs, new MessageRegistry());
    expect(vi.mocked(flatten).mock.calls.map(([tree]) => tree)).toEqual([catalogs.en]);

    vi.mocked(flatten).mockClear();
    status(cfg, catalogs, new MessageRegistry());
    expect(vi.mocked(flatten).mock.calls.map(([tree]) => tree)).toEqual([catalogs.en]);
  });

  it('the text that ships adds the code to a copy, never to the catalog it was handed', () => {
    const catalogs = read();
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Brand new read`;', 'a.ts'));
    const shipped = shippedCatalogs(cfg, catalogs, registry);
    expect(Object.values(shipped.en!)).toContain('Brand new read');
    expect(Object.values(catalogs.en!)).not.toContain('Brand new read');
  });

  it('a catalog with no prototype that still holds groups is read leaf by leaf', () => {
    const grouped = Object.assign(emptyCatalog(), {
      nav: { home: 'Home', docs: 'Docs' },
    } as unknown as Record<string, string>);
    const catalogs = { en: grouped, es: asRead({ 'nav.home': 'Inicio' }) };
    const result = check(cfg, catalogs, new MessageRegistry());
    expect(result.missing).toEqual([{ locale: 'es', key: 'nav.docs', source: 'Docs' }]);
  });

  it('a relative message inside a group is still seen', () => {
    const nested = { en: { g: { deep: 'Seen {when:relative/day}' } } } as unknown as Catalogs;
    expect(needsRelative(nested)).toBe(true);
  });
});
