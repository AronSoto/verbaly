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

  it('keeps the first message and hands both sites of a collision to whoever reports it', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze("t.id('dup')`Hola`;", 'a.ts'));
    registry.update('b.ts', analyze("t.id('dup')`Chau`;", 'b.ts'));

    expect(registry.messages().get('dup')?.message).toBe('Hola');
    const [collision] = registry.collisions();
    expect(collision?.key).toBe('dup');
    expect([collision?.kept.file, collision?.kept.message]).toEqual(['a.ts', 'Hola']);
    expect(collision?.dropped.map((msg) => [msg.file, msg.message])).toEqual([['b.ts', 'Chau']]);
  });

  it('never prints anything itself, however many times the map is rebuilt', () => {
    // one command rebuilds it three times; the callers that know the root say it, with file:line
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze("t.id('twice')`Hola`;", 'a.ts'));
    registry.update('b.ts', analyze("t.id('twice')`Chau`;", 'b.ts'));

    registry.messages();
    registry.messages();
    expect(registry.collisions()).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  // Proved able to fail by deduping by text again: c.ts was never named, so fixing b revealed it.
  it('names every place a different text is written, and the same text twice is no collision', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze("t.id('k')`Hola`;", 'a.ts'));
    registry.update('b.ts', analyze("t.id('k')`Chau`;", 'b.ts'));
    registry.update('c.ts', analyze("t.id('k')`Chau`;", 'c.ts'));
    registry.update('d.ts', analyze('t`Igual`;', 'd.ts'));
    registry.update('e.ts', analyze('t`Igual`;', 'e.ts'));

    const collisions = registry.collisions();
    expect(collisions.map((entry) => entry.key)).toEqual(['k']);
    expect(collisions[0]?.dropped.map((msg) => msg.file)).toEqual(['b.ts', 'c.ts']);
  });

  // Proved able to fail by keeping the first file registered: z.ts won when it loaded first.
  it('picks the same winner whatever order the files arrive in, the earliest path first', () => {
    const forward = new MessageRegistry();
    forward.update('/p/a.ts', analyze("t.id('k')`From a`;", '/p/a.ts'));
    forward.update('/p/z.ts', analyze("t.id('k')`From z`;", '/p/z.ts'));
    const backward = new MessageRegistry();
    backward.update('/p/z.ts', analyze("t.id('k')`From z`;", '/p/z.ts'));
    backward.update('/p/a.ts', analyze("t.id('k')`From a`;", '/p/a.ts'));

    expect(forward.messages().get('k')?.message).toBe('From a');
    expect(backward.messages().get('k')?.message).toBe('From a');
    expect(backward.collisions()[0]?.kept.file).toBe('/p/a.ts');
    expect([...backward.messages().keys()]).toEqual([...forward.messages().keys()]);
  });

  it('within one file, the first place written wins', () => {
    const registry = new MessageRegistry();
    registry.update('a.ts', analyze("t.id('k')`One`;\nt.id('k')`Two`;", 'a.ts'));
    expect(registry.messages().get('k')?.message).toBe('One');
    expect(registry.collisions()[0]?.dropped.map((msg) => msg.line)).toEqual([2]);
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
