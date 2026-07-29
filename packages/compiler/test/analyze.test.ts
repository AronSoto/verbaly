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

  it('ignores calls without a string literal key', () => {
    const { tagged, usedKeys } = analyze('t(); t(key); t(123);', 'app.ts');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('bails the outer template on a nested t but extracts the inner one', () => {
    const { tagged } = analyze("t`a ${t.id('inner')`b`}`;", 'app.ts');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.key).toBe('inner');
    expect(tagged[0]?.message).toBe('b');
  });

  it('keeps templates whose params hold unrelated tags', () => {
    const { tagged } = analyze('t`x ${css`red`}`;', 'app.ts');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('x {_0}');
  });

  it('falls back to raw text when an escape has no cooked value', () => {
    const { tagged } = analyze('t`bad \\uXYZ end`;', 'app.ts');
    expect(tagged[0]?.message).toBe('bad \\uXYZ end');
  });

  it('names computed member expressions positionally', () => {
    const { tagged } = analyze("t`Hi ${user['name']}`;", 'app.ts');
    expect(tagged[0]?.message).toBe('Hi {_0}');
  });

  it('names private member expressions positionally', () => {
    const code = 'class A { #n = 1; m() { return t`v ${this.#n}`; } }';
    const { tagged } = analyze(code, 'app.ts');
    expect(tagged[0]?.message).toBe('v {_0}');
  });

  it('walks arrays with holes', () => {
    const { tagged } = analyze('const x = [1, , 2]; t`Hola`;', 'app.ts');
    expect(tagged[0]?.message).toBe('Hola');
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

  it('ignores call tags whose callee is not a member', () => {
    const { tagged } = analyze("fn('k')`msg`;", 'app.ts');
    expect(tagged).toHaveLength(0);
  });

  it('ignores computed id access', () => {
    const { tagged } = analyze("t['id']('k')`msg`;", 'app.ts');
    expect(tagged).toHaveLength(0);
  });

  it('ignores member tags whose property is not id', () => {
    const { tagged } = analyze("t.plural('k')`msg`;", 'app.ts');
    expect(tagged).toHaveLength(0);
  });

  it('ignores private-name member tags', () => {
    const code = "class A { #id = 0; m() { return t.#id('k')`msg`; } }";
    const { tagged } = analyze(code, 'app.ts');
    expect(tagged).toHaveLength(0);
  });

  it('skips id calls with the wrong arity', () => {
    const { tagged, usedKeys } = analyze("t.id('a', 'b')`msg`; t.id()`msg`;", 'app.ts');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
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

  it('skips <Trans> with a dynamic id', () => {
    const { tagged, usedKeys } = analyze('const A = () => <Trans id={key}>Hi</Trans>;', 'App.tsx');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('skips <Trans> with a bare id attribute', () => {
    const { tagged, usedKeys } = analyze('const A = () => <Trans id>Hi</Trans>;', 'App.tsx');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('records the key when id children are only whitespace', () => {
    const { tagged, usedKeys } = analyze(
      'const A = () => <Trans id="home.title">   </Trans>;',
      'App.tsx',
    );
    expect(tagged).toHaveLength(0);
    expect(usedKeys.map((u) => u.key)).toEqual(['home.title']);
  });

  it('records the key when id children bail on a nested t', () => {
    const { tagged, usedKeys } = analyze(
      'const A = () => <Trans id="home.title">{t`inner`}</Trans>;',
      'App.tsx',
    );
    // the nested t`inner` is still extracted on its own
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('inner');
    expect(usedKeys.map((u) => u.key)).toEqual(['home.title']);
  });

  it('skips <Trans> with hand-written props and no id', () => {
    const { tagged, usedKeys } = analyze('const A = () => <Trans count={n}>Hi</Trans>;', 'App.tsx');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('skips <Trans> without children', () => {
    const { tagged, usedKeys } = analyze('const A = () => <Trans></Trans>;', 'App.tsx');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('drops empty jsx expressions', () => {
    const { tagged } = analyze('const A = () => <Trans>a{/* note */}b</Trans>;', 'App.tsx');
    expect(tagged[0]?.message).toBe('ab');
  });

  it('dedupes repeated components with identical sources', () => {
    const { tagged } = analyze(
      'const A = () => <Trans><b>one</b> and <b>two</b></Trans>;',
      'App.tsx',
    );
    expect(tagged[0]?.message).toBe('<b>one</b> and <b>two</b>');
    expect(tagged[0]?.jsx?.components).toEqual([{ name: 'b', source: '<b />' }]);
  });

  it('bails when a nested element contains a fragment', () => {
    const { tagged } = analyze('const A = () => <Trans><b>x<></></b></Trans>;', 'App.tsx');
    expect(tagged).toHaveLength(0);
  });

  it('drops blank lines between a param and following text', () => {
    const code = 'const A = () => <Trans>{n}\n\nhello</Trans>;';
    const { tagged } = analyze(code, 'App.tsx');
    expect(tagged[0]?.message).toBe('{n}hello');
  });
});

describe('stray imports', () => {
  it('records t imported from the core package', () => {
    const { strayImports } = analyze("import { t } from 'verbaly';", 'app.ts');
    expect(strayImports).toEqual([{ name: 't', source: 'verbaly', file: 'app.ts' }]);
  });

  it('records t imported from a scoped verbaly package', () => {
    const { strayImports } = analyze("import { useT, t } from '@verbaly/react';", 'App.tsx');
    expect(strayImports.map((entry) => entry.source)).toEqual(['@verbaly/react']);
  });

  it('ignores a renamed binding that is not t, and other packages', () => {
    const code = "import { useT as t } from '@verbaly/react';\nimport { t } from './local';";
    expect(analyze(code, 'App.tsx').strayImports).toEqual([]);
  });

  it('ignores the exports the packages really have', () => {
    const code = "import { createVerbaly, bindDom } from 'verbaly';";
    expect(analyze(code, 'app.ts').strayImports).toEqual([]);
  });
});
