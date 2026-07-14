import { describe, expect, it } from 'vitest';
import { stableKey } from '../src/key';
import { analyzeFile, analyzeSfc } from '../src/sfc';
import { transformCode } from '../src/transform';

describe('analyzeFile', () => {
  it('dispatches plain files to analyze', () => {
    const { tagged } = analyzeFile('const a = t`Hola ${name}`;', 'app.ts');
    expect(tagged[0]?.message).toBe('Hola {name}');
    expect(tagged[0]?.singleQuote).toBeUndefined();
  });
});

describe('analyzeSfc svelte', () => {
  it('extracts tagged templates from script blocks', () => {
    const code = '<script>\n  const msg = t`Hola ${name}`;\n</script>\n<p>{msg}</p>';
    const { tagged } = analyzeSfc(code, 'App.svelte');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('Hola {name}');
    expect(tagged[0]?.key).toBe(stableKey('Hola {name}'));
    expect(tagged[0]?.singleQuote).toBeUndefined();
    expect(code.slice(tagged[0]!.start, tagged[0]!.end)).toBe('t`Hola ${name}`');
  });

  it('extracts $t store tags from markup', () => {
    const code = '<h1>{$t`Hello ${name}`}</h1>';
    const { tagged } = analyzeSfc(code, 'App.svelte');
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.message).toBe('Hello {name}');
    expect(tagged[0]?.singleQuote).toBe(true);
    expect(code.slice(tagged[0]!.start, tagged[0]!.end)).toBe('$t`Hello ${name}`');
  });

  it('extracts $t from script blocks too', () => {
    const { tagged } = analyzeSfc('<script>\n  $: msg = $t`Bye`;\n</script>', 'App.svelte');
    expect(tagged[0]?.message).toBe('Bye');
  });

  it('handles multiple script blocks with correct offsets', () => {
    const code =
      '<script context="module">\n  const a = t`One`;\n</script>\n' +
      '<script>\n  const b = t`Two`;\n</script>';
    const { tagged } = analyzeSfc(code, 'App.svelte');
    expect(tagged.map((m) => m.message)).toEqual(['One', 'Two']);
    for (const msg of tagged) {
      expect(code.slice(msg.start, msg.end)).toBe(`t\`${msg.message}\``);
    }
  });

  it('records $t call keys from markup as used keys', () => {
    const { usedKeys, tagged } = analyzeSfc("<p>{$t('inbox', { count: 3 })}</p>", 'App.svelte');
    expect(tagged).toHaveLength(0);
    expect(usedKeys.map((u) => u.key)).toEqual(['inbox']);
  });

  it('extracts t.id from markup under the explicit key', () => {
    const { tagged } = analyzeSfc("<h1>{$t.id('home.title')`Hola ${name}`}</h1>", 'App.svelte');
    expect(tagged[0]?.key).toBe('home.title');
    expect(tagged[0]?.message).toBe('Hola {name}');
  });

  it('extracts from attribute expressions', () => {
    const { tagged } = analyzeSfc('<img alt={$t`Company logo`} src="/logo.png" />', 'App.svelte');
    expect(tagged[0]?.message).toBe('Company logo');
  });

  it('ignores commented-out markup', () => {
    const { tagged, usedKeys } = analyzeSfc("<!-- {$t`nope`} {$t('gone')} -->", 'App.svelte');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('never turns prose into keys or messages', () => {
    const code = "<p>don't (worry), it`s fine</p>";
    const { tagged, usedKeys } = analyzeSfc(code, 'App.svelte');
    expect(tagged).toHaveLength(0);
    expect(usedKeys).toHaveLength(0);
  });

  it('handles nested braces and templates inside params', () => {
    const { tagged } = analyzeSfc('<p>{$t`Total ${fmt({ n: a + b })}`}</p>', 'App.svelte');
    expect(tagged[0]?.message).toBe('Total {_0}');
  });

  it('survives an unterminated expression at EOF', () => {
    const { tagged } = analyzeSfc('<p>{$t`oops', 'App.svelte');
    expect(tagged).toHaveLength(0);
  });
});

describe('analyzeSfc vue', () => {
  it('extracts tagged templates from script setup', () => {
    const code = "<script setup lang=\"ts\">\nconst msg = t`Hola ${name}`;\n</script>";
    const { tagged } = analyzeSfc(code, 'App.vue');
    expect(tagged[0]?.message).toBe('Hola {name}');
    expect(tagged[0]?.singleQuote).toBeUndefined();
  });

  it('extracts from template interpolations', () => {
    const code = '<template>\n  <p>{{ t`Hello ${name}` }}</p>\n</template>';
    const { tagged } = analyzeSfc(code, 'App.vue');
    expect(tagged[0]?.message).toBe('Hello {name}');
    expect(tagged[0]?.singleQuote).toBe(true);
  });

  it('extracts from directive bindings', () => {
    const { tagged } = analyzeSfc('<template><a :title="t`Open menu`">…</a></template>', 'App.vue');
    expect(tagged[0]?.message).toBe('Open menu');
  });

  it('records call keys from templates as used keys', () => {
    const { usedKeys } = analyzeSfc("<template><p>{{ t('inbox') }}</p></template>", 'App.vue');
    expect(usedKeys.map((u) => u.key)).toEqual(['inbox']);
  });

  it('does not treat $t as the tag outside svelte', () => {
    const { tagged } = analyzeSfc('<template><p>{{ $t`Nope` }}</p></template>', 'App.vue');
    expect(tagged).toHaveLength(0);
  });

  it('ignores style blocks', () => {
    const code = '<style>\n.x::before { content: "t`nope`"; }\n</style>';
    const { tagged } = analyzeSfc(code, 'App.vue');
    expect(tagged).toHaveLength(0);
  });
});

describe('transformCode on SFCs', () => {
  it('rewrites svelte markup with single quotes', () => {
    const key = stableKey('Hello {name}');
    const result = transformCode('<h1>{$t`Hello ${name}`}</h1>', 'App.svelte');
    expect(result?.code).toBe(`<h1>{$t('${key}', { 'name': name })}</h1>`);
  });

  it('rewrites svelte script blocks with double quotes', () => {
    const key = stableKey('Hola');
    const result = transformCode('<script>const a = t`Hola`;</script>', 'App.svelte');
    expect(result?.code).toBe(`<script>const a = t(${JSON.stringify(key)});</script>`);
  });

  it('keeps vue directive attributes valid', () => {
    const key = stableKey('Open menu');
    const result = transformCode('<template><a :title="t`Open menu`">x</a></template>', 'App.vue');
    expect(result?.code).toBe(`<template><a :title="t('${key}')">x</a></template>`);
  });

  it('rewrites explicit ids in markup', () => {
    const result = transformCode("<h1>{$t.id('home.title')`Hola`}</h1>", 'App.svelte');
    expect(result?.code).toBe("<h1>{$t('home.title')}</h1>");
  });

  it('returns null for an SFC without messages', () => {
    expect(transformCode('<p>hola</p>', 'App.svelte')).toBeNull();
  });
});
