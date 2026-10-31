import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..');
const read = (file: string) => JSON.parse(readFileSync(join(pkgDir, file), 'utf8'));

// the MCP Registry refuses a server.json whose name or version disagrees with the npm package
describe('server.json, the MCP Registry entry', () => {
  const pkg = read('package.json');
  const server = read('server.json');

  it('carries the name npm publishes as mcpName', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.packages[0].identifier).toBe(pkg.name);
  });

  it('moves with the release: both versions are the package version', () => {
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it('keeps the description under the 100 characters the registry allows', () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});
