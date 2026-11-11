import { ESLint } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// eslint loads the repo's own config, with its parsers: not a 5s job on a cold machine
const LINT_TIMEOUT = 60_000;

const repo = join(import.meta.dirname, '..', '..', '..');
const file = join(repo, 'packages', 'studio', 'src', 'ui', 'components', 'Lint.svelte');

async function lint(script: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: repo });
  const code = `<script lang="ts">\n${script}\n</script>\n\n<p>{shown}</p>\n`;
  const [result] = await eslint.lintText(code, { filePath: file });
  return result!.messages.map((message) => `${message.ruleId}: ${message.message}`);
}

describe('the comment rule reads a component, which it never did while eslint only read js and ts', () => {
  it(
    'flags a comment of two lines and one past the limit in a svelte script',
    async () => {
      const long = `  // ${'word '.repeat(22)}`;
      const found = await lint(
        `  // the first line of a why\n  // and its second\n  let shown = $state(1);\n${long}\n  shown += 1;`,
      );
      expect(found.filter((line) => line.startsWith('verbaly/one-line'))).toHaveLength(2);
    },
    LINT_TIMEOUT,
  );

  it(
    'takes a svelte-ignore for the directive it is, and a rune or a browser global for no error',
    async () => {
      const found = await lint(
        `  // fixed at mount on purpose\n  // svelte-ignore state_referenced_locally\n  let shown = $state(document.title);\n  shown = 'later';`,
      );
      expect(found).toEqual([]);
    },
    LINT_TIMEOUT,
  );
});
