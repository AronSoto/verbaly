import { defineConfig } from 'vitest/config';

// keeps the package run isolated from the root projects config
export default defineConfig({ test: { testTimeout: 20000 } });
