import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
const DIRECTORY = 'plugins/verbaly';
const directory = read(`${DIRECTORY}/.claude-plugin/plugin.json`);

// every store runs the server of its own release: Anthropic's directory refuses an unpinned npx
const LINE = { command: 'npx', args: ['-y', `${pkg.name}@${pkg.version}`] };

// the directory lists a plugin only with a README of at least 40 words, code blocks not counted
function proseWords(folder: string): number {
  const readme = readFileSync(join(repo, folder, 'README.md'), 'utf8');
  return readme
    .replace(/```[\s\S]*?```/g, '')
    .split(/\s+/)
    .filter(Boolean).length;
}

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
    expect(directory.version).toBe(pkg.version);
  });

  it('point the marketplace at the one skill, under the name the plugin gives itself', () => {
    const [entry] = marketplace.plugins;
    expect(marketplace.plugins).toHaveLength(1);
    expect(entry.name).toBe(plugin.name);
    expect(entry.source).toBe('./skills/verbaly');
    // the plugin is the skill's own folder: one SKILL.md at its root, loaded as the one skill
    expect(existsSync(join(repo, entry.source, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, entry.source, 'skills'))).toBe(false);
    expect(proseWords(entry.source)).toBeGreaterThanOrEqual(40);
  });

  it('says the same thing about itself in every store', () => {
    expect(gemini.description).toBe(plugin.description);
    expect(marketplace.plugins[0].description).toBe(plugin.description);
  });

  it('keeps the repository root free of a server a session on this repo would load', () => {
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
  });
});

// the directory blocks a launcher under our pnpm-workspace.yaml: its plugin is the skill alone
describe('the plugin for Anthropic directory, the skill alone', () => {
  it('teaches the same cycle: its SKILL.md is the skill, byte for byte', () => {
    const skill = readFileSync(join(repo, 'skills/verbaly/SKILL.md'));
    expect(readFileSync(join(repo, DIRECTORY, 'SKILL.md')).equals(skill)).toBe(true);
  });

  it('runs nothing: no server, no hook, and no package file a launcher or an install reads', () => {
    expect(directory.name).toBe(plugin.name);
    expect(directory.license).toBe('MIT');
    for (const key of ['mcpServers', 'hooks', 'lspServers'])
      expect(directory).not.toHaveProperty(key);
    const files = readdirSync(join(repo, DIRECTORY), { recursive: true }).map(String);
    const runs = /(^|[\\/])(\.mcp\.json|package\.json|.*lock.*|\.npmrc|hooks|bin)$/;
    expect(files.filter((file) => runs.test(file))).toEqual([]);
  });

  it('links the support, privacy and terms pages its listing shows', () => {
    for (const key of ['supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
      expect(String(directory[key]).startsWith('https://')).toBe(true);
    }
  });

  it('says what it runs and how to add the server, in a README the directory accepts', () => {
    expect(proseWords(DIRECTORY)).toBeGreaterThanOrEqual(40);
    const readme = readFileSync(join(repo, DIRECTORY, 'README.md'), 'utf8');
    expect(readme).toContain(`claude mcp add verbaly -- npx -y ${pkg.name}`);
    // the skill asks for a machine translation, so the README names where the texts go
    const skill = readFileSync(join(repo, DIRECTORY, 'SKILL.md'), 'utf8');
    if (skill.includes('verbaly translate')) {
      expect(readme).toContain('npx verbaly translate');
      expect(readme).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('brings the icon the directory takes once: a square PNG from 512 to 2048 px, under 2 MB', () => {
    const icon = join(repo, DIRECTORY, '.claude-plugin/icon.png');
    const bytes = readFileSync(icon);
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
    expect(width).toBeLessThanOrEqual(2048);
    expect(statSync(icon).size).toBeLessThan(2 * 1024 * 1024);
  });

  it('stays out of the marketplace and of skills/, so the other stores still find one skill', () => {
    const sources = marketplace.plugins.map((entry: { source: string }) => entry.source);
    expect(sources).not.toContain(`./${DIRECTORY}`);
    expect(DIRECTORY.startsWith('skills/')).toBe(false);
  });
});
