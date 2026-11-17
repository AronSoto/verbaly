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
const cursorMarketplace = read('.cursor-plugin/marketplace.json');
const CURSOR = cursorMarketplace.plugins[0].source;
const cursor = read(`${CURSOR}/.cursor-plugin/plugin.json`);
const cursorServers = read(`${CURSOR}/mcp.json`);

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
    // every plugin of Cursor's own marketplace names a file, so this one does too
    expect(cursor.mcpServers).toBe('./mcp.json');
    expect(cursorServers).toEqual({ mcpServers: { verbaly: LINE } });
    // a person who types the line gets the latest, which is the package the manifests pin
    const readme = readFileSync(join(pkgDir, 'README.md'), 'utf8');
    expect(readme).toContain(`claude mcp add verbaly -- npx -y ${pkg.name}`);
  });

  it('move with the release: each version is the package version', () => {
    expect(plugin.version).toBe(pkg.version);
    expect(gemini.version).toBe(pkg.version);
    expect(directory.version).toBe(pkg.version);
    expect(cursor.version).toBe(pkg.version);
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
    expect(cursor.description).toBe(plugin.description);
    expect(cursorMarketplace.plugins[0].description).toBe(plugin.description);
  });

  it('keeps the repository root free of a server a session on this repo would load', () => {
    expect(existsSync(join(repo, '.mcp.json'))).toBe(false);
  });
});

// the keys Cursor's schemas allow (cursor/plugins, schemas/): both refuse any other key
const CURSOR_KEYS = {
  plugin: [
    'name',
    'displayName',
    'description',
    'version',
    'minClientVersions',
    'author',
    'publisher',
    'homepage',
    'repository',
    'license',
    'logo',
    'keywords',
    'category',
    'tags',
    'commands',
    'agents',
    'skills',
    'rules',
    'hooks',
    'variables',
    'mcpServers',
  ],
  person: ['name', 'email'],
  marketplace: ['name', 'owner', 'metadata', 'plugins'],
  entry: ['name', 'source', 'description', 'minClientVersions'],
};

describe('the plugin for Cursor, in the same folder as the one for Claude Code', () => {
  it('is that folder, under the name the Claude Code plugin gives itself', () => {
    expect(cursorMarketplace.plugins).toHaveLength(1);
    expect(cursorMarketplace.plugins[0].name).toBe(plugin.name);
    expect(cursor.name).toBe(plugin.name);
    expect(join(repo, CURSOR)).toBe(join(repo, marketplace.plugins[0].source));
  });

  it("loads the folder's SKILL.md as its one skill, which needs no skills field and no skills/", () => {
    expect(cursor).not.toHaveProperty('skills');
    expect(existsSync(join(repo, CURSOR, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(repo, CURSOR, 'skills'))).toBe(false);
  });

  it('names only files inside the folder, as relative paths', () => {
    for (const path of [cursor.logo, cursor.mcpServers]) {
      expect(path.startsWith('/') || path.split(/[\\/]/).includes('..')).toBe(false);
      expect(existsSync(join(repo, CURSOR, path))).toBe(true);
    }
  });

  it("shows the icon Anthropic's directory shows", () => {
    const logo = readFileSync(join(repo, CURSOR, cursor.logo));
    expect(logo.equals(readFileSync(join(repo, DIRECTORY, '.claude-plugin/icon.png')))).toBe(true);
  });

  it("holds only what Cursor's schemas accept, in the form they accept", () => {
    expect(cursor.name).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/);
    expect(Object.keys(cursor).filter((key) => !CURSOR_KEYS.plugin.includes(key))).toEqual([]);
    expect(Object.keys(cursor.author).filter((key) => !CURSOR_KEYS.person.includes(key))).toEqual(
      [],
    );
    const top = Object.keys(cursorMarketplace);
    expect(top.filter((key) => !CURSOR_KEYS.marketplace.includes(key))).toEqual([]);
    const owner = Object.keys(cursorMarketplace.owner);
    expect(owner.filter((key) => !CURSOR_KEYS.person.includes(key))).toEqual([]);
    const entry = Object.keys(cursorMarketplace.plugins[0]);
    expect(entry.filter((key) => !CURSOR_KEYS.entry.includes(key))).toEqual([]);
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
