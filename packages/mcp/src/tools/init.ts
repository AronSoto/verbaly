import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { init } from '@verbaly/compiler';
import { z } from 'zod';
import { reply, rootInput, writes, type ToolContext } from './shared';

export function registerInit(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_init',
    {
      title: 'Set up Verbaly in a project',
      description:
        'Create the config file and the locale catalogs, and detect the bundler or meta-framework so the answer names the package to add and the line to wire (what `verbaly init` does). A file already there is kept, never overwritten, so running it again is safe. Use it when verbaly_doctor finds no config; once the project is set up, verbaly_doctor is the one to run.',
      inputSchema: {
        root: rootInput,
        dir: z.string().optional().describe('Directory for the catalogs (default: locales)'),
        sourceLocale: z.string().optional().describe('The language you write in (default: en)'),
        locales: z.array(z.string()).optional().describe('Every locale, source included'),
      },
      outputSchema: {
        created: z.array(z.string()).describe('Files written, relative to the project root'),
        skipped: z.array(z.string()).describe('Files already there, left untouched'),
        host: z
          .string()
          .optional()
          .describe('Bundler or meta-framework detected from the dependencies'),
        configFile: z.string(),
        next: z.array(z.string()).describe('What a human still has to do, in order'),
        renamed: z
          .array(z.object({ from: z.string(), to: z.string() }))
          .describe('Locales written with the hyphen a locale tag takes (pt_BR became pt-BR)'),
        refused: z
          .array(z.string())
          .describe('Locales left out: not a locale tag, and no sure way to fix one'),
        found: z
          .string()
          .optional()
          .describe('Catalogs the project already had, which the new config points at'),
      },
      annotations: writes(false),
    },
    ctx.guarded(async ({ root, dir, sourceLocale, locales }) => {
      const result = await init({ root: root ?? ctx.root, dir, sourceLocale, locales });
      const lines: string[] = [];
      if (result.created.length) lines.push(`created: ${result.created.join(', ')}`);
      if (result.skipped.length) lines.push(`kept (already there): ${result.skipped.join(', ')}`);
      for (const { from, to } of result.renamed) lines.push(`wrote ${to} for ${from}`);
      for (const locale of result.refused) {
        lines.push(`left out "${locale}": it is not a locale tag, use one like es or pt-BR`);
      }
      if (result.found) lines.push(`catalogs: ${result.found}, kept where they already are`);
      if (result.host) lines.push(`detected: ${result.host}`);
      lines.push(...result.next.map((step, i) => `${i + 1}. ${step}`));
      return reply(lines.join('\n'), { ...result });
    }),
  );
}
