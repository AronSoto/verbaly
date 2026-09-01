import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { analyzeFile } from '../src/sfc';
import { wrapCode, wrapProject } from '../src/wrap';

const APP_WITH_T = 'const t = useT();\nexport const x = <h1>Welcome back</h1>;\n';

describe('wrapCode', () => {
  it('wraps a plain text child', () => {
    const out = wrapCode('const x = <h1>Welcome back</h1>;', 'App.tsx');
    expect(out.code).toBe('const x = <h1>{t`Welcome back`}</h1>;');
    expect(out.wrapped).toEqual([{ file: 'App.tsx', line: 1, text: 'Welcome back', kind: 'text' }]);
  });

  it('leaves the contents of code and pre alone', () => {
    const code = 'const x = <pre><code>python -m research.experiment --seed 42</code></pre>;';
    const out = wrapCode(code, 'App.tsx');
    expect(out.code).toBeUndefined();
    expect(out.wrapped).toEqual([]);
  });

  it('leaves a lone lowercase token alone, in text and in attributes', () => {
    // demo credentials, slugs and handles read as copy to a scanner that only looks for letters
    expect(wrapCode('const x = <span>analyst</span>;', 'App.tsx').code).toBeUndefined();
    expect(wrapCode('const x = <span>hapi-demo</span>;', 'App.tsx').code).toBeUndefined();
    expect(wrapCode('const x = <img alt="logo.png" />;', 'App.tsx').code).toBeUndefined();
    // a capital says a human wrote it as a word, so a one-word label still gets wrapped
    expect(wrapCode('const x = <span>Save</span>;', 'App.tsx').code).toContain('{t`Save`}');
  });

  it('refuses a message that opens with an interpolation', () => {
    const code = 'const x = <p>{lead} and the rest of the sentence follows.</p>;';
    const out = wrapCode(code, 'App.tsx');
    expect(out.code).toBeUndefined();
    expect(out.skipped[0]?.reason).toContain('starts with an interpolation');
  });

  it('knows whether t is bound, however it was bound', () => {
    const jsx = 'export const x = <h1>Welcome back</h1>;';
    expect(wrapCode(jsx, 'App.tsx').hasT).toBe(false);
    expect(wrapCode(`const t = useT();\n${jsx}`, 'App.tsx').hasT).toBe(true);
    expect(wrapCode(`const { t } = useI18n();\n${jsx}`, 'App.tsx').hasT).toBe(true);
    expect(wrapCode(`import { t } from './i18n';\n${jsx}`, 'App.tsx').hasT).toBe(true);
    expect(wrapCode(`function C({ t }) { return ${jsx.slice(17)} }`, 'App.tsx').hasT).toBe(true);
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
  function makeProject(source = APP_WITH_T): string {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-wrap-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'App.tsx'), source);
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
    expect(result.blocked).toEqual([]);
    expect(readFileSync(join(root, 'src', 'App.tsx'), 'utf8')).toContain('{t`Welcome back`}');
    expect(readFileSync(join(root, 'src', 'util.ts'), 'utf8')).toContain("'not jsx'");
  });

  it('writes nothing into a file with no t, and says how many texts wait there', async () => {
    // the reported failure: 149 texts written across 32 files, none of which declared t
    const root = makeProject('export const x = <h1>Welcome back</h1>;\n');
    const result = await wrapProject(resolveConfig({ root }), { write: true });
    expect(result.blocked).toEqual([{ file: 'src/App.tsx', texts: 1, client: false }]);
    expect(readFileSync(join(root, 'src', 'App.tsx'), 'utf8')).toContain('<h1>Welcome back</h1>');
  });

  it('reports which side a blocked file renders on, because it picks the binding', async () => {
    const root = makeProject("'use client';\nexport const x = <h1>Welcome back</h1>;\n");
    const result = await wrapProject(resolveConfig({ root }), { write: true });
    expect(result.blocked[0]).toMatchObject({ client: true });
  });
});
