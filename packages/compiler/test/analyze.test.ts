import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analyze';
import { stableKey } from '../src/key';

describe('analyze', () => {
  it('extracts tagged templates', () => {
    const { tagged } = analyze('const a = t`Hola ${name}`;', 'app.ts');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('Hola {name}');
    expect(tagged[0]?.key).toBe(stableKey('Hola {name}'));
    expect(tagged[0]?.params.map((p) => p.name)).toEqual(['name']);
  });

  it('supports member tags', () => {
    const { tagged } = analyze('i18n.t`Bye ${user.name}`;', 'app.ts');
    expect(tagged[0]?.message).toBe('Bye {name}');
  });

  it('names complex expressions positionally', () => {
    const { tagged } = analyze('t`Total ${a + b}`;', 'app.ts');
    expect(tagged[0]?.message).toBe('Total {_0}');
  });

  it('reuses the name for identical expressions', () => {
    const { tagged } = analyze('t`${name} y ${name}`;', 'app.ts');
    expect(tagged[0]?.message).toBe('{name} y {name}');
  });

  it('suffixes colliding names from different expressions', () => {
    const { tagged } = analyze('t`${user.name} vs ${account.name}`;', 'app.ts');
    expect(tagged[0]?.message).toBe('{name} vs {name2}');
  });

  it('escapes literal braces', () => {
    const { tagged } = analyze('t`set {mode} on`;', 'app.ts');
    expect(tagged[0]?.message).toBe('set {{mode}} on');
  });

  it('records explicit keys', () => {
    const { usedKeys } = analyze("t('home.title'); v.t('nav.back');", 'app.ts');
    expect(usedKeys.map((u) => u.key)).toEqual(['home.title', 'nav.back']);
  });

  it('ignores unrelated tags and calls', () => {
    const { tagged, usedKeys } = analyze('css`color: red`; fetch("/x");', 'app.ts');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('parses tsx', () => {
    const { tagged } = analyze('export const A = () => <p>{t`Hi ${n}`}</p>;', 'App.tsx');
    expect(tagged[0]?.message).toBe('Hi {n}');
  });
});
