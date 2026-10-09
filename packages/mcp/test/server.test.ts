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

// contents is a text-or-blob union and every resource here is text: narrow once, not per test
function resourceText(read: { contents: Array<Record<string, unknown>> }): string {
  const first = read.contents[0];
  if (typeof first?.text !== 'string') throw new Error('resource returned no text');
  return first.text;
}

function resultText(result: unknown): string {
  const { content } = result as { content: Array<{ type: string; text: string }> };
  return content.map((entry) => entry.text).join('\n');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createVerbalyMcp', () => {
  it('exposes the cycle tools, each with an output schema', async () => {
    const client = await connect(makeProject());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'verbaly_doctor',
      'verbaly_drafts',
      'verbaly_extract',
      'verbaly_init',
      'verbaly_missing',
      'verbaly_status',
      'verbaly_translate',
      'verbaly_wrap',
      'verbaly_write_drafts',
    ]);
    // an agent that has to regex the text is an agent one wording change away from breaking
    expect(tools.every((tool) => tool.outputSchema !== undefined)).toBe(true);
    const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual([
      'verbaly_doctor',
      'verbaly_drafts',
      'verbaly_missing',
      'verbaly_status',
    ]);
  });

  it('serves the tools in the order an agent meets a project, which is what the docs claim', async () => {
    const client = await connect(makeProject());
    const { tools } = await client.listTools();
    // an agent reads this list top to bottom, so registration order is a documented promise
    expect(tools.map((tool) => tool.name)).toEqual([
      'verbaly_init',
      'verbaly_doctor',
      'verbaly_wrap',
      'verbaly_extract',
      'verbaly_status',
      'verbaly_missing',
      'verbaly_translate',
      'verbaly_write_drafts',
      'verbaly_drafts',
    ]);
  });

  it('never exposes a tool that approves a draft, and says so where an agent reads', async () => {
    const client = await connect(makeProject());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).not.toContain('verbaly_review');
    const drafts = tools.find((tool) => tool.name === 'verbaly_drafts');
    expect(drafts?.description).toContain('never will be');
  });

  it('serves the project shape as a resource, so reading it costs no tool call', async () => {
    const client = await connect(makeProject());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('verbaly://config');

    const read = await client.readResource({ uri: 'verbaly://config' });
    const shape = JSON.parse(resourceText(read)) as {
      sourceLocale: string;
      locales: string[];
      routing: string;
    };
    expect(shape.sourceLocale).toBe('en');
    expect(shape.locales).toEqual(['en', 'es']);
    expect(shape.routing).toBe('no-prefix');
  });

  it('serves one catalog per locale, flattened the way the runtime reads it', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate)).toContain('verbaly://catalog/{locale}');

    const read = await client.readResource({ uri: 'verbaly://catalog/en' });
    const catalog = JSON.parse(resourceText(read)) as Record<string, string>;
    // the whole point: a tool could count this message, none of them could read what it says
    expect(Object.values(catalog)).toContain('Hello {name}');
  });

  it('reads the text that ships, not a catalog the code has moved past', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    // the code changes its text and nobody extracts: an agent must translate the new one
    writeFileSync(join(root, 'src', 'app.ts'), 'export const msg = t.id("greet")`Hi there`;\n');
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ greet: 'Hello' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ greet: '' }));
    const read = await client.readResource({ uri: 'verbaly://catalog/en' });
    const catalog = JSON.parse(resourceText(read)) as Record<string, string>;
    expect(catalog.greet).toBe('Hi there');
  });

  it('refuses a locale the project does not have, naming the ones it does', async () => {
    const client = await connect(makeProject());
    await expect(client.readResource({ uri: 'verbaly://catalog/fr' })).rejects.toThrow('en, es');
  });

  it('init scaffolds a project from nothing and names what a human still has to do', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-mcp-init-'));
    tempDirs.push(root);
    const client = await connect(root);
    const result = await client.callTool({ name: 'verbaly_init', arguments: { locales: ['en', 'es'] } });
    const data = structured(result) as { created: string[]; next: string[]; configFile: string };

    expect(existsSync(join(root, data.configFile))).toBe(true);
    expect(data.created.length).toBeGreaterThan(0);
    expect(data.next.length).toBeGreaterThan(0);
  });

  it('init keeps a file that is already there instead of overwriting it', async () => {
    const root = makeProject();
    const client = await connect(root);
    const before = readFileSync(join(root, 'verbaly.config.mjs'), 'utf8');
    const result = await client.callTool({ name: 'verbaly_init', arguments: {} });

    expect(readFileSync(join(root, 'verbaly.config.mjs'), 'utf8')).toBe(before);
    expect((structured(result) as { skipped: string[] }).skipped.length).toBeGreaterThan(0);
  });

  it('drafts come back with the source and the translation, which is what review needs', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });

    const es = join(root, 'locales', 'es.json');
    const catalog = JSON.parse(readFileSync(es, 'utf8')) as Record<string, string>;
    const key = Object.keys(catalog)[0]!;
    catalog[key] = 'Hola {name}';
    writeFileSync(es, JSON.stringify(catalog, null, 2));
    writeFileSync(
      join(root, 'locales', '.verbaly-drafts.json'),
      JSON.stringify({ es: [key] }, null, 2),
    );

    const result = await client.callTool({ name: 'verbaly_drafts', arguments: {} });
    const data = structured(result) as {
      total: number;
      entries: Array<{ locale: string; key: string; source: string; translated: string }>;
    };
    expect(data.total).toBe(1);
    expect(data.entries[0]).toEqual({
      locale: 'es',
      key,
      source: 'Hello {name}',
      translated: 'Hola {name}',
    });
    expect(resultText(result)).toContain('Hola {name}');
  });

  it('drafts says so plainly when there is nothing to review', async () => {
    const root = makeProject();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const result = await client.callTool({ name: 'verbaly_drafts', arguments: {} });
    expect(resultText(result)).toContain('nothing awaiting review');
    expect((structured(result) as { total: number }).total).toBe(0);
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
    // src/ is where a project without a framework slot keeps its types, never the root
    expect(readFileSync(join(root, 'src', 'verbaly.d.ts'), 'utf8')).toContain('name');
    expect(existsSync(join(root, 'verbaly.d.ts'))).toBe(false);
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
    const state = JSON.parse(
      readFileSync(join(root, 'locales', '.verbaly-state.json'), 'utf8'),
    ) as { drafts: Record<string, string[]> };
    expect(state.drafts.es).toHaveLength(1);

    // the draft shows up in status and in the opt-in missing view
    expect(resultText(await client.callTool({ name: 'verbaly_status', arguments: {} }))).toContain(
      '1 unreviewed',
    );
    expect(
      resultText(await client.callTool({ name: 'verbaly_missing', arguments: { drafts: true } })),
    ).toContain('unreviewed');
  });

  // Proved able to fail by writing the run's own copy back: the text written by hand is replaced.
  it('translate keeps a message someone wrote while the provider was working', async () => {
    const root = makeProject(
      'translate: { provider: async ({ messages }) => { const fs = await import("node:fs"); const file = new URL("./locales/es.json", import.meta.url); const catalog = JSON.parse(fs.readFileSync(file, "utf8")); for (const key of Object.keys(messages)) catalog[key] = "Hola a mano {name}"; fs.writeFileSync(file, JSON.stringify(catalog)); return Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, "ES " + v])); } }',
    );
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const result = await client.callTool({ name: 'verbaly_translate', arguments: {} });

    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(Object.values(es)).toEqual(['Hola a mano {name}']);
    const data = structured(result) as {
      translated: Array<{ locale: string; keys: string[] }>;
      kept: Array<{ locale: string; keys: string[] }>;
    };
    expect(data.translated).toEqual([]);
    expect(data.kept).toEqual([{ locale: 'es', keys: Object.keys(es) }]);
    expect(existsSync(join(root, 'locales', '.verbaly-state.json'))).toBe(false);
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
      'const t = useT();\nexport const Page = () => <p title="Open me">Hello there</p>;\n',
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

  it('wrap hands back the files it refused to write, so an agent can bind t first', async () => {
    const root = makeProject();
    writeFileSync(
      join(root, 'src', 'Page.jsx'),
      "'use client';\nexport const Page = () => <p>Hello there</p>;\n",
    );
    const client = await connect(root);
    const applied = structured(
      await client.callTool({ name: 'verbaly_wrap', arguments: { write: true } }),
    ) as { blocked: Array<{ file: string; texts: number; client: boolean }> };
    expect(applied.blocked).toEqual([{ file: 'src/Page.jsx', texts: 1, client: true }]);
    expect(readFileSync(join(root, 'src', 'Page.jsx'), 'utf8')).toContain('<p>Hello there</p>');
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
    expect(data.locales).toEqual([
      { locale: 'es', translated: 0, total: 1, drafts: 0, broken: 0, outdated: 0 },
    ]);
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

  // Proved able to fail without the guard: prune deleted bye, which only the broken file reads.
  it('extract names the files it could not read, and prune waits for them', async () => {
    const root = makeProject();
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'locales', 'en.json'), '{"bye":"Bye"}');
    writeFileSync(join(root, 'locales', 'es.json'), '{"bye":"Adiós"}');
    writeFileSync(join(root, 'src', 'bye.ts'), "export const b = t('bye'); const c = ;\n");
    const client = await connect(root);
    const result = await client.callTool({ name: 'verbaly_extract', arguments: { prune: true } });
    const data = structured(result) as {
      pruned: Array<{ locale: string; keys: string[] }>;
      unparsed: Array<{ file: string; message: string }>;
    };

    expect(data.pruned).toEqual([]);
    expect(data.unparsed.map((entry) => entry.file)).toEqual(['src/bye.ts']);
    expect(resultText(result)).toContain('prune skipped');
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as object;
    expect(es).toHaveProperty('bye', 'Adiós');
  });
});

describe('createVerbalyMcp: an agent never edits a catalog or the state by hand (0.67.0)', () => {
  function keyed(): string {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-mcp-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'src', 'app.ts'), "t('greet'); t('bye');\n");
    writeFileSync(join(root, 'verbaly.config.mjs'), "export default { locales: ['en', 'es'] };\n");
    writeFileSync(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ greet: 'Hello {name}', bye: 'Bye' }),
    );
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ greet: '', bye: 'Adiós' }));
    return root;
  }

  it('write_drafts saves what the agent wrote, checked, and marks it unreviewed', async () => {
    const root = keyed();
    const client = await connect(root);
    const result = await client.callTool({
      name: 'verbaly_write_drafts',
      arguments: {
        locale: 'es',
        entries: [
          { key: 'greet', text: 'Hola {name}' },
          { key: 'bye', text: 'Chao' },
          { key: 'ghost', text: 'Fantasma' },
        ],
      },
    });
    expect(structured(result)).toEqual({
      written: ['greet'],
      kept: ['bye'],
      invalid: [],
      unknown: ['ghost'],
    });
    const es = JSON.parse(readFileSync(join(root, 'locales', 'es.json'), 'utf8')) as object;
    expect(es).toEqual({ bye: 'Adiós', greet: 'Hola {name}' });
    const state = JSON.parse(readFileSync(join(root, 'locales', '.verbaly-state.json'), 'utf8'));
    expect(state.drafts).toEqual({ es: ['greet'] });
    expect(resultText(result)).toContain('saved as drafts, awaiting human review');
  });

  it('write_drafts rejects a translation that loses a param, and overwrite redoes one', async () => {
    const root = keyed();
    const client = await connect(root);
    const lost = await client.callTool({
      name: 'verbaly_write_drafts',
      arguments: { locale: 'es', entries: [{ key: 'greet', text: 'Hola' }] },
    });
    expect((structured(lost) as { invalid: string[] }).invalid).toEqual(['greet']);
    const redo = await client.callTool({
      name: 'verbaly_write_drafts',
      arguments: { locale: 'es', entries: [{ key: 'bye', text: 'Chao' }], overwrite: true },
    });
    expect((structured(redo) as { written: string[] }).written).toEqual(['bye']);
  });

  it('write_drafts refuses the source locale with a message, not a stack', async () => {
    const client = await connect(keyed());
    const result = await client.callTool({
      name: 'verbaly_write_drafts',
      arguments: { locale: 'en', entries: [{ key: 'bye', text: 'Bye!' }] },
    });
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain('"en" is not a language this project translates into');
  });

  it('missing lists an outdated translation, and extract names a collision', async () => {
    const root = keyed();
    const client = await connect(root);
    await client.callTool({ name: 'verbaly_extract', arguments: {} });
    writeFileSync(
      join(root, 'locales', 'en.json'),
      JSON.stringify({ greet: 'Hello {name}', bye: 'Goodbye' }),
    );
    const missing = structured(await client.callTool({ name: 'verbaly_missing', arguments: {} }));
    expect((missing as { outdated: unknown }).outdated).toEqual([{ locale: 'es', key: 'bye' }]);

    writeFileSync(join(root, 'src', 'dup.ts'), "t.id('dup')`One`;\nt.id('dup')`Two`;\n");
    const extract = structured(await client.callTool({ name: 'verbaly_extract', arguments: {} }));
    expect((extract as { collisions: unknown }).collisions).toEqual([
      {
        key: 'dup',
        sites: [
          { file: 'src/dup.ts', line: 1, message: 'One' },
          { file: 'src/dup.ts', line: 2, message: 'Two' },
        ],
      },
    ]);
  });
});

describe('createVerbalyMcp: the same pipeline and the same answers as the CLI (0.68.0)', () => {
  function owned(): string {
    const root = mkdtempSync(join(tmpdir(), 'verbaly-mcp-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'locales'));
    writeFileSync(join(root, 'verbaly.config.mjs'), "export default { locales: ['en', 'es'] };\n");
    writeFileSync(
      join(root, 'src', 'app.ts'),
      "export const a = t.id('greet')`Hello ${name}`;\nexport const b = t`Updated ${format(d)}`;\n",
    );
    writeFileSync(join(root, 'locales', 'en.json'), JSON.stringify({ greet: 'Hello' }));
    writeFileSync(join(root, 'locales', 'es.json'), JSON.stringify({ greet: '' }));
    return root;
  }

  // Proved able to fail with the 0.67.0 extract: a hand edit the code undid was never mentioned.
  it('extract hands an agent what the CLI prints: replaced texts and nameless values', async () => {
    const client = await connect(owned());
    const result = await client.callTool({ name: 'verbaly_extract', arguments: {} });
    const data = structured(result) as {
      replaced: unknown;
      positional: Array<{ params: string[]; code: { file: string; line?: number } }>;
    };
    expect(data.replaced).toEqual([
      {
        key: 'greet',
        before: 'Hello',
        code: { file: 'src/app.ts', line: 1, message: 'Hello {name}' },
      },
    ]);
    expect(
      data.positional.map((entry) => [entry.params, entry.code.file, entry.code.line]),
    ).toEqual([[['_0'], 'src/app.ts', 2]]);
    expect(resultText(result)).toContain('en: greet follows the code (src/app.ts:1)');
  });

  // Proved able to fail by validating against the catalog: the agent's draft passed, check failed.
  it('write_drafts checks an agent against the text that ships, the one missing reads', async () => {
    const client = await connect(owned());
    const lost = await client.callTool({
      name: 'verbaly_write_drafts',
      arguments: { locale: 'es', entries: [{ key: 'greet', text: 'Hola' }] },
    });
    expect((structured(lost) as { invalid: string[] }).invalid).toEqual(['greet']);
  });

  // Proved able to fail by reading the state strictly: the call errored with drafts never asked.
  it('missing still answers when the state file is broken and drafts were not asked for', async () => {
    const root = owned();
    writeFileSync(join(root, 'locales', '.verbaly-state.json'), '<<<<<<< HEAD');
    const client = await connect(root);
    const result = await client.callTool({ name: 'verbaly_missing', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((structured(result) as { stateProblem?: string }).stateProblem).toMatch(
      /not valid JSON/,
    );
    const asked = await client.callTool({ name: 'verbaly_missing', arguments: { drafts: true } });
    expect(asked.isError).toBe(true);
    const status = await client.callTool({ name: 'verbaly_status', arguments: {} });
    expect(status.isError).toBeFalsy();
  });

  // Proved able to fail by letting updateState throw: the catalogs were written, the call errored.
  it('extract writes the catalogs and reports a broken state file instead of failing', async () => {
    const root = owned();
    writeFileSync(join(root, 'locales', '.verbaly-state.json'), '<<<<<<< HEAD');
    const client = await connect(root);
    const result = await client.callTool({ name: 'verbaly_extract', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect((structured(result) as { stateProblem?: string }).stateProblem).toMatch(
      /not valid JSON/,
    );
    expect(JSON.parse(readFileSync(join(root, 'locales', 'en.json'), 'utf8')).greet).toBe(
      'Hello {name}',
    );
  });

  it('missing names files relative to the project, as extract does', async () => {
    const root = owned();
    writeFileSync(join(root, 'src', 'dup.ts'), "t.id('dup')`One`;\nt.id('dup')`Two`;\n");
    const client = await connect(root);
    const missing = structured(
      await client.callTool({ name: 'verbaly_missing', arguments: {} }),
    ) as {
      collisions: Array<{ sites: Array<{ file: string }> }>;
      divergent: Array<{ code: { file: string } }>;
    };
    expect(missing.collisions[0]?.sites.map((at) => at.file)).toEqual(['src/dup.ts', 'src/dup.ts']);
    expect(missing.divergent[0]?.code.file).toBe('src/app.ts');
  });
});
