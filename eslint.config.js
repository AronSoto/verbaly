import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';
import { oneLine } from './scripts/eslint-one-line.mjs';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', '.claude/', '**/*.d.ts']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', fetch: 'readonly' } },
  },
  {
    // the parser alone: it is what lets the comment rule read the script of a component
    files: ['**/*.svelte'],
    languageOptions: { parser: svelteParser, parserOptions: { parser: tseslint.parser } },
    // svelte-check owns the types here, and an assignment to a rune is read by the template
    rules: { 'no-undef': 'off', 'no-useless-assignment': 'off' },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,cts,mts,svelte}'],
    plugins: { verbaly: { rules: { 'one-line': oneLine } } },
    rules: { 'verbaly/one-line': 'error' },
  },
]);
