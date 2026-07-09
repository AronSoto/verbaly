import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config';
import { extractProject } from '../src/extract';
import { stableKey } from '../src/key';

describe('extractProject', () => {
  it('globs source files and skips excluded paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-extract-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'src', 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'src', 'app.ts'), 'const s = t`Hola ${name}`;\n');
    writeFileSync(join(root, 'src', 'other.tsx'), "t('home.title');\n");
    writeFileSync(join(root, 'src', 'node_modules', 'dep', 'i.ts'), 't`Ignorada`;\n');

    const registry = await extractProject(resolveConfig({ root, sourceLocale: 'es' }));
    const messages = registry.messages();
    expect(messages.has(stableKey('Hola {name}'))).toBe(true);
    expect(messages.has(stableKey('Ignorada'))).toBe(false);
    expect(registry.usedKeys().has('home.title')).toBe(true);
  });
});
