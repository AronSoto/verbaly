import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { analyzeFile } from '../src/sfc';
import { wrapCode, wrapProject } from '../src/wrap';

describe('wrapCode', () => {
  it('wraps a plain text child', () => {
    const out = wrapCode('const x = <h1>Welcome back</h1>;', 'App.tsx');
    expect(out.code).toBe('const x = <h1>{t`Welcome back`}</h1>;');
    expect(out.wrapped).toEqual([{ file: 'App.tsx', line: 1, text: 'Welcome back', kind: 'text' }]);
  });

  it('joins text and expressions into one message', () => {
    const out = wrapCode('const x = <p>Hello {name}, you have {count} new</p>;', 'App.tsx');
    expect(out.code).toBe('const x = <p>{t`Hello ${name}, you have ${count} new`}</p>;');
  });

  it('what wrap writes is exactly what extraction reads back', () => {
    const out = wrapCode('const x = <p>Hello {user.name}, bye</p>;', 'App.tsx');
    const { tagged } = analyzeFile(out.code!, 'App.tsx');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('Hello {name}, bye');
  });

  it('keeps indentation outside the wrap', () => {
    const code = 'const x = (\n  <h1>\n    Welcome back\n  </h1>\n);';
    const out = wrapCode(code, 'App.tsx');
    expect(out.code).toBe('const x = (\n  <h1>\n    {t`Welcome back`}\n  </h1>\n);');
  });

  it('wraps user-visible string attributes', () => {
    const out = wrapCode(
      'const x = <img alt="Company logo" src="/a.png" width="20" />;',
      'App.tsx',
    );
    expect(out.code).toBe('const x = <img alt={t`Company logo`} src="/a.png" width="20" />;');
    expect(out.wrapped[0]).toMatchObject({ kind: 'attribute', attribute: 'alt' });
  });

  it('leaves text without letters alone', () => {
    const out = wrapCode('const x = <span>42 %</span>;', 'App.tsx');
    expect(out.code).toBeUndefined();
    expect(out.wrapped).toHaveLength(0);
  });

  it('reports mixed text and markup instead of splitting the sentence', () => {
    const out = wrapCode('const x = <p>Hello <b>world</b> friend</p>;', 'App.tsx');
    expect(out.code).toBeUndefined();
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]?.reason).toContain('<Trans>');
  });

  it('recurses into pure element children', () => {
    const out = wrapCode('const x = <div><p>First</p><p>Second</p></div>;', 'App.tsx');
    expect(out.code).toBe('const x = <div><p>{t`First`}</p><p>{t`Second`}</p></div>;');
  });

  it('skips segments that already use t', () => {
    const out = wrapCode('const x = <p>Hi {t`there`} friend</p>;', 'App.tsx');
    expect(out.code).toBeUndefined();
    expect(out.skipped[0]?.reason).toContain('already uses t');
  });

  it('skips expressions that render markup, subtree included', () => {
    const out = wrapCode(
      'const x = <p>State {ok ? <b>ready</b> : <i>loading</i>} now</p>;',
      'App.tsx',
    );
    expect(out.code).toBeUndefined();
    expect(out.skipped).toHaveLength(1);
  });

  it('leaves <Trans> children and data-verbaly subtrees untouched', () => {
    const trans = wrapCode('const x = <Trans>Already handled</Trans>;', 'App.tsx');
    expect(trans.code).toBeUndefined();
    const bound = wrapCode('const x = <p data-verbaly="key">Fallback text</p>;', 'App.tsx');
    expect(bound.code).toBeUndefined();
  });

  it('escapes backticks and interpolation markers in literal text', () => {
    const out = wrapCode("const x = <p>{'a `quoted` ${x} text'}</p>;", 'App.tsx');
    expect(out.code).toBe('const x = <p>{t`a \\`quoted\\` \\${x} text`}</p>;');
    const { tagged } = analyzeFile(out.code!, 'App.tsx');
    // {{ }} is the message-format escape: it renders as the literal ${x}
    expect(tagged[0]?.message).toBe('a `quoted` ${{x}} text');
  });

  it('survives an unparseable file', () => {
    const out = wrapCode('const x = <p>oops', 'App.tsx');
    expect(out.wrapped).toHaveLength(0);
  });
});

describe('wrapProject', () => {
  function makeProject(): string {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-wrap-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'App.tsx'), 'export const x = <h1>Welcome back</h1>;\n');
    writeFileSync(join(root, 'src', 'util.ts'), "export const label = 'not jsx';\n");
    return root;
  }

  it('reports without touching files by default', async () => {
    const root = makeProject();
    const result = await wrapProject(resolveConfig({ root }));
    expect(result.changed).toEqual(['src/App.tsx']);
    expect(result.wrapped).toHaveLength(1);
    expect(readFileSync(join(root, 'src', 'App.tsx'), 'utf8')).toContain('<h1>Welcome back</h1>');
  });

  it('rewrites files with write: true, jsx carriers only', async () => {
    const root = makeProject();
    const result = await wrapProject(resolveConfig({ root }), { write: true });
    expect(result.changed).toEqual(['src/App.tsx']);
    expect(readFileSync(join(root, 'src', 'App.tsx'), 'utf8')).toContain('{t`Welcome back`}');
    expect(readFileSync(join(root, 'src', 'util.ts'), 'utf8')).toContain("'not jsx'");
  });
});
