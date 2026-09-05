import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', '.claude/', '**/*.d.ts']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
]);
