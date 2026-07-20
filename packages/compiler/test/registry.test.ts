import { describe, expect, it, vi } from 'vitest';
import { analyze } from '../src/analyze';
import { MessageRegistry } from '../src/registry';
import { stableKey } from '../src/key';

describe('MessageRegistry', () => {
  it('drops a removed file from messages and usedKeys', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Hola`;', 'a.ts'));
    registry.update('b.ts', analyze("t('home.title');", 'b.ts'));

    registry.remove('a.ts');
    expect(registry.messages().has(stableKey('Hola'))).toBe(false);
    expect(registry.usedKeys().has('home.title')).toBe(true);

    registry.remove('b.ts');
    expect(registry.usedKeys().size).toBe(0);
  });

  it('origins merges tagged and used-key files per key', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Hola`;', 'a.ts'));
    registry.update('b.ts', analyze("t('" + stableKey('Hola') + "');", 'b.ts'));

    const origins = registry.origins();
    expect(origins.get(stableKey('Hola'))?.sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('warns on key collisions and keeps the first message', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze("t.id('dup')`Hola`;", 'a.ts'));
    registry.update('b.ts', analyze("t.id('dup')`Chau`;", 'b.ts'));

    expect(registry.messages().get('dup')?.message).toBe('Hola');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('key collision "dup"'));
    spy.mockRestore();
  });

  it('does not warn when both files carry the same message', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Hola`;', 'a.ts'));
    registry.update('b.ts', analyze('t`Hola`;', 'b.ts'));

    expect(registry.messages().size).toBe(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('dedupes usedKeys per file and lists every file', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze("t('k'); t('k');", 'a.ts'));
    registry.update('b.ts', analyze("t('k');", 'b.ts'));
    expect(registry.usedKeys().get('k')).toEqual(['a.ts', 'b.ts']);
  });

  it('origins lists a tagged-only message that no t() call references', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze('t`Solo`;', 'a.ts'));
    expect(registry.origins().get(stableKey('Solo'))).toEqual(['a.ts']);
  });
});
