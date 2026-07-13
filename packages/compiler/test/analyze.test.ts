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

describe('analyze t.id', () => {
  it('extracts explicit readable keys', () => {
    const { tagged } = analyze("const a = t.id('home.greet')`Hola ${name}`;", 'app.ts');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.key).toBe('home.greet');
    expect(tagged[0]?.message).toBe('Hola {name}');
    expect(tagged[0]?.params.map((p) => p.name)).toEqual(['name']);
  });

  it('supports member t references', () => {
    const { tagged } = analyze("i18n.t.id('nav.back')`Volver`;", 'app.ts');
    expect(tagged[0]?.key).toBe('nav.back');
  });

  it('skips dynamic ids', () => {
    const { tagged, usedKeys } = analyze('t.id(key)`Hola`;', 'app.ts');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('ignores unrelated .id tags', () => {
    const { tagged } = analyze("css.id('x')`color: red`;", 'app.ts');
    expect(tagged).toHaveLength(0);
  });
});

describe('analyze <Trans>', () => {
  it('extracts plain text', () => {
    const { tagged } = analyze('const A = () => <Trans>Hello world</Trans>;', 'App.tsx');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('Hello world');
    expect(tagged[0]?.key).toBe(stableKey('Hello world'));
    expect(tagged[0]?.jsx?.name).toBe('Trans');
  });

  it('extracts params from expressions', () => {
    const { tagged } = analyze(
      'const A = () => <Trans>Hello {user.name}, you have {count} messages</Trans>;',
      'App.tsx',
    );
    expect(tagged[0]?.message).toBe('Hello {name}, you have {count} messages');
    expect(tagged[0]?.params.map((p) => p.name)).toEqual(['name', 'count']);
  });

  it('extracts nested elements as named tags', () => {
    const { tagged } = analyze(
      'const A = () => <Trans>Read the <a href="/terms">terms</a> now</Trans>;',
      'App.tsx',
    );
    expect(tagged[0]?.message).toBe('Read the <a>terms</a> now');
    expect(tagged[0]?.jsx?.components).toEqual([{ name: 'a', source: '<a href="/terms" />' }]);
  });

  it('lowercases component tags and keeps self-closing', () => {
    const { tagged } = analyze(
      'const A = () => <Trans>Line one<Break/>line two</Trans>;',
      'App.tsx',
    );
    expect(tagged[0]?.message).toBe('Line one<break/>line two');
    expect(tagged[0]?.jsx?.components).toEqual([{ name: 'break', source: '<Break/>' }]);
  });

  it('suffixes colliding tag names with different sources', () => {
    const { tagged } = analyze(
      'const A = () => <Trans><a href="/a">one</a> y <a href="/b">two</a></Trans>;',
      'App.tsx',
    );
    expect(tagged[0]?.message).toBe('<a>one</a> y <a2>two</a2>');
    expect(tagged[0]?.jsx?.components.map((c) => c.name)).toEqual(['a', 'a2']);
  });

  it('collapses jsx whitespace exactly like React', () => {
    const code = `const A = () => (
      <Trans>
        Read the <em>terms</em>
        before continuing
      </Trans>
    );`;
    const { tagged } = analyze(code, 'App.tsx');
    // React drops the newline after </em>: faithful extraction does too
    expect(tagged[0]?.message).toBe('Read the <em>terms</em>before continuing');
  });

  it("honors the {' '} idiom", () => {
    const code = `const A = () => (
      <Trans>
        Read the <em>terms</em>{' '}
        before continuing
      </Trans>
    );`;
    const { tagged } = analyze(code, 'App.tsx');
    expect(tagged[0]?.message).toBe('Read the <em>terms</em> before continuing');
  });

  it('records <Trans id> as a used key and skips extraction', () => {
    const { tagged, usedKeys } = analyze('const A = () => <Trans id="home.title" />;', 'App.tsx');
    expect(tagged).toHaveLength(0);
    expect(usedKeys.map((u) => u.key)).toEqual(['home.title']);
  });

  it('extracts <Trans id> with children under the explicit key', () => {
    const { tagged, usedKeys } = analyze(
      'const A = () => <Trans id="home.title">Hello {user.name}</Trans>;',
      'App.tsx',
    );
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.key).toBe('home.title');
    expect(tagged[0]?.message).toBe('Hello {name}');
    expect(usedKeys).toHaveLength(0);
  });

  it('keeps <Trans id> with extra props runtime-first', () => {
    const { tagged, usedKeys } = analyze(
      'const A = () => <Trans id="home.title" values={{ name }}>Hello</Trans>;',
      'App.tsx',
    );
    expect(tagged).toHaveLength(0);
    expect(usedKeys.map((u) => u.key)).toEqual(['home.title']);
  });

  it('bails on fragments and nested Trans', () => {
    const { tagged } = analyze(
      'const A = () => <Trans>a<></>b</Trans>; const B = () => <Trans>x<Trans>y</Trans></Trans>;',
      'App.tsx',
    );
    expect(tagged.filter((m) => m.jsx)).toHaveLength(1); // only the inner y
    expect(tagged[0]?.message).toBe('y');
  });

  it('ignores other jsx elements', () => {
    const { tagged } = analyze('const A = () => <p>Hello</p>;', 'App.tsx');
    expect(tagged).toHaveLength(0);
  });
});
