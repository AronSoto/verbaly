import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { oneLine } from './scripts/eslint-one-line.mjs';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', '.claude/', '**/*.d.ts']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,cts,mts}'],
    plugins: { verbaly: { rules: { 'one-line': oneLine } } },
    rules: { 'verbaly/one-line': 'error' },
  },
]);
