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

function structured(result: unknown): unknown {
  return (result as { structuredContent?: unknown }).structuredContent;
}

function resultText(result: unknown): string {
  const { content } = result as { content: Array<{ type: string; text: string }> };
  return content.map((entry) => entry.text).join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createVerbalyMcp', () => {
  it('exposes the six cycle tools, each with an output schema', async () => {
    const client = await connect(makeProject());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'verbaly_doctor',
      'verbaly_extract',
      'verbaly_missing',
      'verbaly_status',
      'verbaly_translate',
      'verbaly_wrap',
    ]);
    // an agent that has to regex the text is an agent one wording change away from breaking
    expect(tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual(['verbaly_doctor', 'verbaly_missing', 'verbaly_status']);
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

  it('a provider failure names the keys it cost and keeps the run alive', async () => {
    const root = makeProject(
      'translate: { retries: 0, provider: async () => { throw new Error("provider exploded") } }',
    );
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const result = await client.callTool({ name: 'verbaly_translate', arguments: {} });

    // not a crashed tool: the batch failed, so a retry can ask for exactly what is left
    expect((result as { isError?: boolean }).isError).toBeUndefined();
    expect(resultText(result)).toContain('provider exploded');
    const data = structured(result) as { failed: Array<{ locale: string; keys: string[] }> };
    expect(data.failed).toHaveLength(1);
    expect(data.failed[0]!.locale).toBe('es');
    expect(data.failed[0]!.keys).toHaveLength(1);
  });

  it('a config the server cannot load is still an actionable tool error', async () => {
    const root = makeProject();
    writeFileSync(join(root, 'verbaly.config.mjs'), 'export default {\n');
    const client = await connect(root);
    const result = await client.callTool({ name: 'verbaly_status', arguments: {} });
    expect((result as { isError?: boolean }).isError).toBe(true);
  });
});

describe('createVerbalyMcp: the onboarding half of the cycle', () => {
  it('doctor answers with the entries and whether the setup is healthy', async () => {
    const root = makeProject();
    const client = await connect(root);
    const before = await client.callTool({ name: 'verbaly_doctor', arguments: {} });
    const broken = structured(before) as { ok: boolean; entries: Array<{ level: string }> };
    expect(broken.ok).toBe(false);
    expect(broken.entries.some((entry) => entry.level === 'error')).toBe(true);
    expect(resultText(before)).toContain('problems found');

    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const after = structured(await client.callTool({ name: 'verbaly_doctor', arguments: {} })) as {
      ok: boolean;
      entries: Array<{ check: string; level: string; fix?: string }>;
    };
    // the catalogs exist now, so the error is gone and the untranslated es is only a warn
    expect(after.entries.some((entry) => entry.check === 'catalogs' && entry.level === 'ok')).toBe(
      true,
    );
    expect(after.entries.every((entry) => entry.level !== 'error')).toBe(true);
    expect(after.ok).toBe(true);
  });

  it('wrap names the texts it could not take, not only the ones it took', async () => {
    const root = makeProject();
    writeFileSync(
      join(root, 'src', 'Mixed.jsx'),
      'export const M = () => <p>Hello <b>there</b></p>;\n',
    );
    const client = await connect(root);
    const text = resultText(await client.callTool({ name: 'verbaly_wrap', arguments: {} }));
    expect(text).toContain('needs a human');
    expect(text).toContain('mixed text and markup');
  });
  it('wrap reports hardcoded jsx text and only writes when asked', async () => {
    const root = makeProject();
    writeFileSync(
      join(root, 'src', 'Page.jsx'),
      'export const Page = () => <p title="Open me">Hello there</p>;\n',
    );
    const client = await connect(root);

    const report = structured(await client.callTool({ name: 'verbaly_wrap', arguments: {} })) as {
      write: boolean;
      wrapped: Array<{ text: string; kind: string; attribute?: string }>;
    };
    expect(report.write).toBe(false);
    expect(report.wrapped.map((entry) => entry.text).sort()).toEqual(['Hello there', 'Open me']);
    expect(report.wrapped.find((entry) => entry.kind === 'attribute')?.attribute).toBe('title');
    expect(readFileSync(join(root, 'src', 'Page.jsx'), 'utf8')).toContain('>Hello there<');

    const applied = structured(
      await client.callTool({ name: 'verbaly_wrap', arguments: { write: true } }),
    ) as { write: boolean; changed: string[] };
    expect(applied.write).toBe(true);
    expect(applied.changed).toEqual(['src/Page.jsx']);
    const source = readFileSync(join(root, 'src', 'Page.jsx'), 'utf8');
    expect(source).toContain('{t`Hello there`}');
    expect(source).toContain('t`Open me`');
  });
});

describe('createVerbalyMcp: structured output', () => {
  it('status answers with numbers, not a sentence to parse', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const data = structured(await client.callTool({ name: 'verbaly_status', arguments: {} })) as {
      messages: number;
      source: string;
      locales: Array<Record<string, number | string>>;
    };

    expect(data.messages).toBe(1);
    expect(data.source).toBe('en');
    expect(data.locales).toEqual([{ locale: 'es', translated: 0, total: 1, drafts: 0, broken: 0 }]);
  });

  it('missing answers with the entries the gate found', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const data = structured(await client.callTool({ name: 'verbaly_missing', arguments: {} })) as {
      ok: boolean;
      missing: Array<{ locale: string; source?: string }>;
    };

    expect(data.ok).toBe(false);
    expect(data.missing).toHaveLength(1);
    expect(data.missing[0]!.locale).toBe('es');
    expect(data.missing[0]!.source).toBe('Hello {name}');
  });

  it('extract answers with the counts and the keys it added', async () => {
    const root = makeProject();
    const client = await connect(root);
    const data = structured(await client.callTool({ name: 'verbaly_extract', arguments: {} })) as {
      messages: number;
      locales: string[];
      dryRun: boolean;
      added: Array<{ locale: string; keys: string[] }>;
    };

    expect(data.messages).toBe(1);
    expect(data.locales.sort()).toEqual(['en', 'es']);
    expect(data.dryRun).toBe(false);
    expect(data.added.map((entry) => entry.locale).sort()).toEqual(['en', 'es']);
  });
});
