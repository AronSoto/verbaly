import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = join(fileURLToPath(import.meta.url), '..', '..');
const repo = join(pkgDir, '..', '..');
const read = (file: string) => JSON.parse(readFileSync(join(repo, file), 'utf8'));

const pkg = read('packages/mcp/package.json');
const plugin = read('skills/verbaly/.claude-plugin/plugin.json');
const marketplace = read('.claude-plugin/marketplace.json');
const gemini = read('gemini-extension.json');

// every store runs the server of its own release: Anthropic's directory refuses an unpinned npx
const LINE = { command: 'npx', args: ['-y', `${pkg.name}@${pkg.version}`] };

describe('the manifests each agent store reads', () => {
  it('start the one server, pinned to the version they ship with', () => {
    expect(plugin.mcpServers).toEqual({ verbaly: LINE });
    expect(gemini.mcpServers).toEqual({ verbaly: LINE });
    // a person who types the line gets the latest, which is the package the manifests pin
    const readme = readFileSync(join(pkgDir, 'README.md'), 'utf8');
    expect(readme).toContain(`claude mcp add verbaly -- npx -y ${pkg.name}`);
  });

  it('move with the release: each version is the package version', () => {
    expect(plugin.version).toBe(pkg.version);
    expect(gemini.version).toBe(pkg.version);
  });

  it('point the marketplace at the one skill, under the name the plugin gives itself', () => {
    const [entry] = marketplace.plugins;
    expect(marketplace.plugins).toHaveLength(1);
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toBe('./skills/verbaly');
    // the plugin is the skill's own folder: one SKILL.md at its root, and no second copy
    expect(existsSync(join(repo, entry.source, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, entry.source, 'skills'))).toBe(false);
    // the directory lists a plugin only with a README of at least 40 words in its folder
    const readme = readFileSync(join(repo, entry.source, 'README.md'), 'utf8');
    const prose = readme.replace(/```[\s\S]*?```/g, '');
    expect(prose.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(40);
  });

  it('says the same thing about itself in every store', () => {
    expect(gemini.description).toBe(plugin.description);
    expect(marketplace.plugins[0].description).toBe(plugin.description);
  });

  it('keeps the repository root free of a server a session on this repo would load', () => {
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
  });
});
