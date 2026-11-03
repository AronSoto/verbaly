import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  extractProject,
  loadCatalogs,
  loadConfig,
  shippedCatalogs,
  type ResolvedConfig,
} from '@verbaly/compiler';
import { createRequire } from 'node:module';
import { registerDoctor } from './tools/doctor';
import { registerDrafts } from './tools/drafts';
import { registerExtract } from './tools/extract';
import { registerInit } from './tools/init';
import { registerMissing } from './tools/missing';
import type { ToolContext } from './tools/shared';
import { registerStatus } from './tools/status';
import { registerTranslate } from './tools/translate';
import { registerWrap } from './tools/wrap';
import { registerWriteDrafts } from './tools/write-drafts';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export interface VerbalyMcpOptions {
  root?: string;
}

export function createVerbalyMcp(options: VerbalyMcpOptions = {}): McpServer {
  const server = new McpServer({ name: 'verbaly', version });

  const config = (root?: string): Promise<ResolvedConfig> =>
    loadConfig(root ?? options.root ?? process.cwd());

  // agents act on messages, not stack traces: every failure comes back as actionable text
  const guarded =
    <A>(run: (args: A) => Promise<CallToolResult>) =>
    async (args: A): Promise<CallToolResult> => {
      try {
        return await run(args);
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    };

  // resources, not tools: reading the project is an address, and it must not spend a tool call
  server.registerResource(
    'verbaly-config',
    'verbaly://config',
    {
      title: 'Project shape',
      description:
        'The resolved Verbaly config: source locale, every locale, the catalog directory and where the language lives in the url. Read this before reasoning about anything else in the project.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const cfg = await config();
      const shape = {
        root: cfg.root,
        sourceLocale: cfg.sourceLocale,
        locales: cfg.locales,
        localesDeclared: cfg.localesDeclared,
        dir: cfg.dir,
        routing: cfg.routing,
        include: cfg.include,
      };
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(shape, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'verbaly-catalog',
    new ResourceTemplate('verbaly://catalog/{locale}', {
      list: async () => {
        const cfg = await config();
        return {
          resources: cfg.locales.map((locale) => ({
            name: `${locale} catalog`,
            uri: `verbaly://catalog/${locale}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    {
      title: 'Locale catalog',
      description:
        'Every message of one locale, keyed the way the runtime sees them: a nested catalog arrives flattened, a text the code owns reads as the code has it, and an empty value means untranslated. This is the only way to read what a message actually says.',
      mimeType: 'application/json',
    },
    async (uri, { locale }) => {
      const cfg = await config();
      const name = String(locale);
      if (!cfg.locales.includes(name)) {
        const have = cfg.locales.join(', ');
        throw new Error(`[verbaly] unknown locale "${name}": the project has ${have}`);
      }
      // the text that ships: a catalog the code has moved past would hand an agent the old words
      const registry = await extractProject(cfg);
      const shipped = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
      const catalog = shipped[name] ?? {};
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) },
        ],
      };
    },
  );

  // an agent reads the list top to bottom, so the tools follow the cycle
  const ctx: ToolContext = { root: options.root, config, guarded };
  for (const register of [
    registerInit,
    registerDoctor,
    registerWrap,
    registerExtract,
    registerStatus,
    registerMissing,
    registerTranslate,
    registerWriteDrafts,
    registerDrafts,
  ]) {
    register(server, ctx);
  }

  return server;
}
