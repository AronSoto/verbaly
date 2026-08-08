import { describe, expect, it, vi } from 'vitest';
import { flatten } from '../src/flatten';
import { createVerbaly } from '../src/instance';
import type { MessageTree } from '../src/types';

// a catalog arriving through a lazy loader, addMessages or a CMS never crossed the build gate
const bad = (value: unknown): MessageTree => ({ a: value }) as MessageTree;

describe('flatten with data the gate never saw', () => {
  it('flattens nested groups to dotted keys', () => {
    expect(flatten({ home: { title: 'Hola', sub: { x: 'y' } } })).toEqual({
      'home.title': 'Hola',
      'home.sub.x': 'y',
    });
  });

  it('never throws on a null leaf: it used to take the whole app down at boot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => flatten(bad(null))).not.toThrow();
    expect(flatten(bad(null))).toEqual({});
    expect(() => createVerbaly({ locale: 'en', messages: { en: bad(null) } })).not.toThrow();
    warn.mockRestore();
  });

  it('warns naming the dotted path instead of dropping a leaf in silence', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    flatten({ nav: { count: 3 as unknown as string } });
    expect(warn.mock.calls[0]![0]).toContain('catalog value at "nav.count" is not text');
    warn.mockRestore();
  });

  it('treats an array like doctor does: a leaf that is not text, never index keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(flatten(bad(['x', 'y']))).toEqual({});
    warn.mockRestore();
  });

  it('survives a catalog that is not an object at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(flatten(null as unknown as MessageTree)).toEqual({});
    expect(flatten('nope' as unknown as MessageTree)).toEqual({});
    warn.mockRestore();
  });

  it('keeps the good keys of a catalog with one bad leaf', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const v = createVerbaly({
      locale: 'en',
      messages: { en: { ok: 'Hello', broken: undefined as unknown as string } },
    });
    expect(v.t('ok')).toBe('Hello');
    warn.mockRestore();
  });
});
