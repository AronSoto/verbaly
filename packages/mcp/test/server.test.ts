import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVerbalyMcp } from '../src/server';

const tempDirs: string[] = [];

function makeProject(config = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'verbaly-mcp-'));
  tempDirs.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'app.ts'), 'export const msg = t`Hello ${name}`;\n');
  writeFileSync(
    join(root, 'verbaly.config.mjs'),
    `export default { locales: ['es'] ${config ? ', ' + config : ''} };\n`,
  );
  return root;
}

async function connect(root?: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createVerbalyMcp(root === undefined ? {} : { root });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function resultText(result: unknown): string {
  const { content } = result as { content: Array<{ type: string; text: string }> };
  return content.map((entry) => entry.text).join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createVerbalyMcp', () => {
  it('exposes the four cycle tools', async () => {
    const client = await connect(makeProject());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'verbaly_extract',
      'verbaly_missing',
      'verbaly_status',
      'verbaly_translate',
    ]);
  });

  it('extract writes catalogs and types, and reports the counts', async () => {
    const root = makeProject();
    const client = await connect(root);
    const result = await client.callTool({ name: 'verbaly_extract', arguments: {} });

    expect(resultText(result)).toContain('1 message');
    const en = JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(Object.values(en)).toEqual(['Hello {name}']);
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(Object.values(es)).toEqual(['']);
    expect(readFileSync(join(root, 'verbaly.d.ts'), 'utf8')).toContain('name');
  });

  it('extract dryRun writes nothing', async () => {
    const root = makeProject();
    const client = await connect(root);
    const result = await client.callTool({
      name: 'verbaly_extract',
      arguments: { dryRun: true },
    });
    expect(resultText(result)).toContain('dry run');
    expect(existsSync(join(root, 'locales'))).toBe(false);
  });

  it('status and missing see the gap, then the filled catalog', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });

    expect(resultText(await client.callTool({ name: 'verbaly_status', arguments: {} }))).toContain(
      'es: 0/1 translated (0%)',
    );
    const missing = resultText(await client.callTool({ name: 'verbaly_missing', arguments: {} }));
    expect(missing).toContain('missing translations:');
    expect(missing).toContain('[es]');

    const es = join(root, 'locales', 'es.json');
    const catalog = JSON.parse(readFileSync(es, 'utf8')) as Record<string, string>;
    for (const key of Object.keys(catalog)) catalog[key] = 'Hola {name}';
    writeFileSync(es, JSON.stringify(catalog));

    expect(resultText(await client.callTool({ name: 'verbaly_missing', arguments: {} }))).toBe(
      'all translations complete',
    );
  });

  it('the per-tool root argument overrides the server root', async () => {
    const root = makeProject();
    const client = await connect('/nowhere/that/exists');
    const result = await client.callTool({ name: 'verbaly_extract', arguments: { root } });
    expect(resultText(result)).toContain('1 message');
    expect(existsSync(join(root, 'locales', 'en.json'))).toBe(true);
  });

  it('translate fills via the configured provider and marks drafts', async () => {
    const root = makeProject(
      'translate: { provider: async ({ messages }) => Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, "ES " + v])) }',
    );
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const result = await client.callTool({ name: 'verbaly_translate', arguments: {} });

    expect(resultText(result)).toContain('es: +1 translated (draft)');
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(Object.values(es)).toEqual(['ES Hello {name}']);
    const drafts = JSON.parse(
      readFileSync(join(root, 'locales', '.verbaly-drafts.json'), 'utf8'),
    ) as Record<string, string[]>;
    expect(drafts.es).toHaveLength(1);

    // the draft shows up in status and in the opt-in missing view
    expect(resultText(await client.callTool({ name: 'verbaly_status', arguments: {} }))).toContain(
      '1 unreviewed',
    );
    expect(
      resultText(await client.callTool({ name: 'verbaly_missing', arguments: { drafts: true } })),
    ).toContain('unreviewed');
  });

  it('translate dryRun lists pending entries without calling any provider', async () => {
    const root = makeProject('translate: { provider: async () => { throw new Error("never") } }');
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const result = await client.callTool({
      name: 'verbaly_translate',
      arguments: { dryRun: true },
    });
    expect(resultText(result)).toContain('es: 1 missing');
  });

  it('a provider failure comes back as an actionable tool error, not a crash', async () => {
    const root = makeProject(
      'translate: { provider: async () => { throw new Error("provider exploded") } }',
    );
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const result = await client.callTool({ name: 'verbaly_translate', arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(resultText(result)).toContain('provider exploded');
  });
});
