import { describe, expect, it } from 'vitest';
import { stableKey } from '../src/key';
import { transformCode } from '../src/transform';

describe('transformCode', () => {
  it('rewrites tagged templates to keyed calls', () => {
    const key = stableKey('Hola {name}');
    const result = transformCode('const a = t`Hola ${name}`;', 'app.ts');
    expect(result?.code).toBe(`const a = t(${JSON.stringify(key)}, { "name": name });`);
  });

  it('keeps member tags', () => {
    const key = stableKey('Bye {name}');
    const result = transformCode('i18n.t`Bye ${user.name}`;', 'app.ts');
    expect(result?.code).toBe(`i18n.t(${JSON.stringify(key)}, { "name": user.name });`);
  });

  it('omits params object when empty', () => {
    const key = stableKey('Hola');
    const result = transformCode('t`Hola`;', 'app.ts');
    expect(result?.code).toBe(`t(${JSON.stringify(key)});`);
  });

  it('dedupes repeated params', () => {
    const key = stableKey('{name} y {name}');
    const result = transformCode('t`${name} y ${name}`;', 'app.ts');
    expect(result?.code).toBe(`t(${JSON.stringify(key)}, { "name": name });`);
  });

  it('returns null without matches', () => {
    expect(transformCode('const x = 1;', 'app.ts')).toBeNull();
  });

  it('produces a sourcemap', () => {
    const result = transformCode('t`Hola ${name}`;', 'app.ts');
    expect(result?.map.mappings.length).toBeGreaterThan(0);
  });
});
