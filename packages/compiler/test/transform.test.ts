import { describe, expect, it } from 'vitest';
import { stableKey } from '../src/util/key';
import { analyze } from '../src/scan/analyze';
import { transformCode } from '../src/scan/transform';

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

  it('bails the outer message on nested t`…`: never overlapping rewrites', () => {
    const inner = stableKey('inner');
    const code = 'const a = t`hola ${cond ? t`inner` : x}`;';
    const result = transformCode(code, 'app.ts');
    // the inner message still extracts and rewrites; the outer stays a runtime template
    expect(result?.code).toBe(`const a = t\`hola \${cond ? t(${JSON.stringify(inner)}) : x}\`;`);
  });

  it('bails a <Trans> whose expression hides a nested t`…`', () => {
    const code = '<Trans>hola {cond ? t`inner` : x}</Trans>;';
    expect(() => transformCode(code, 'app.tsx')).not.toThrow();
    // only the inner tagged template rewrites: the Trans is left alone
    expect(transformCode(code, 'app.tsx')?.code).toContain('<Trans>');
  });

  it('produces a sourcemap', () => {
    const result = transformCode('t`Hola ${name}`;', 'app.ts');
    expect(result?.map.mappings.length).toBeGreaterThan(0);
  });

  it('rewrites t.id to a keyed call', () => {
    const result = transformCode("const a = t.id('home.greet')`Hola ${name}`;", 'app.ts');
    expect(result?.code).toBe('const a = t("home.greet", { "name": name });');
  });

  it('rewrites member t.id keeping the receiver', () => {
    const result = transformCode("i18n.t.id('nav.back')`Volver`;", 'app.ts');
    expect(result?.code).toBe('i18n.t("nav.back");');
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

  it('rewrites <Trans id> with children under the explicit key', () => {
    const result = transformCode(
      'const A = () => <Trans id="home.title">Hello {user.name}</Trans>;',
      'App.tsx',
    );
    expect(result?.code).toBe(
      'const A = () => <Trans id="home.title" values={{ "name": user.name }} />;',
    );
  });

  it('rewrites tagged templates and Trans in the same file', () => {
    const code = 'const a = t`Hola`; const A = () => <Trans>Bye</Trans>;';
    const result = transformCode(code, 'App.tsx');
    expect(result?.code).toContain(`t(${JSON.stringify(stableKey('Hola'))})`);
    expect(result?.code).toContain(`<Trans id=${JSON.stringify(stableKey('Bye'))} />`);
  });
});

describe('transformCode: the id it writes on a Trans is the key it read', () => {
  // each case is written out: the key, and the jsx a person would type for it
  it.each([
    ['say "hi"', `{'say "hi"'}`],
    ['a\\b', `{'a\\\\b'}`],
    ['plain.key', `"plain.key"`],
  ])('round-trips %s', (key, written) => {
    const code = `export const A = () => <Trans id=${written}>Hello</Trans>;\n`;
    expect(analyze(code, 'a.tsx').tagged[0]?.key).toBe(key);
    const out = transformCode(code, 'a.tsx')!.code;
    const again = analyze(out, 'a.tsx');
    expect(again.parseError).toBeUndefined();
    expect(again.usedKeys.map((entry) => entry.key)).toEqual([key]);
  });

  it('keeps the quoted form for a key with nothing to escape', () => {
    const out = transformCode(
      `export const A = () => <Trans id="plain.key">Hello</Trans>;\n`,
      'a.tsx',
    );
    expect(out!.code).toBe(`export const A = () => <Trans id="plain.key" />;\n`);
  });
});
