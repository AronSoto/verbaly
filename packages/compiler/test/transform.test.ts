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

describe('transformCode <Trans>', () => {
  it('rewrites plain text to an id', () => {
    const key = stableKey('Hello world');
    const result = transformCode('const A = () => <Trans>Hello world</Trans>;', 'App.tsx');
    expect(result?.code).toBe(`const A = () => <Trans id=${JSON.stringify(key)} />;`);
  });

  it('passes params via values', () => {
    const key = stableKey('Hello {name}');
    const result = transformCode('const A = () => <Trans>Hello {user.name}</Trans>;', 'App.tsx');
    expect(result?.code).toBe(
      `const A = () => <Trans id=${JSON.stringify(key)} values={{ "name": user.name }} />;`,
    );
  });

  it('passes elements via components with attributes intact', () => {
    const key = stableKey('Read the <a>terms</a>');
    const result = transformCode(
      'const A = () => <Trans>Read the <a href="/terms">terms</a></Trans>;',
      'App.tsx',
    );
    expect(result?.code).toBe(
      `const A = () => <Trans id=${JSON.stringify(key)} components={{ "a": <a href="/terms" /> }} />;`,
    );
  });

  it('leaves runtime-first Trans untouched', () => {
    const code = 'const A = () => <Trans id="home.title" />;';
    expect(transformCode(code, 'App.tsx')).toBeNull();
  });

  it('rewrites tagged templates and Trans in the same file', () => {
    const code = 'const a = t`Hola`; const A = () => <Trans>Bye</Trans>;';
    const result = transformCode(code, 'App.tsx');
    expect(result?.code).toContain(`t(${JSON.stringify(stableKey('Hola'))})`);
    expect(result?.code).toContain(`<Trans id=${JSON.stringify(stableKey('Bye'))} />`);
  });
});
