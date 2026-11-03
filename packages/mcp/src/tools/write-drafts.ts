import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { counted, extractProject, writeDrafts } from '@verbaly/compiler';
import { z } from 'zod';
import { reply, rootInput, writes, type ToolContext } from './shared';

export function registerWriteDrafts(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_write_drafts',
    {
      title: 'Save translations an agent wrote',
      description:
        'Save translations you wrote yourself, so neither a catalog nor the state file is ever edited by hand. Each one is checked the way verbaly_translate checks a provider (params, rich tags and plural cases must survive), written only for keys the source catalog has, and marked as a draft awaiting human review. Existing translations are kept unless overwrite is set, which is how an outdated one gets rewritten. Approving is not a tool here: a human reads the drafts (verbaly_drafts lists them) and runs `verbaly review --approve`.',
      inputSchema: {
        root: rootInput,
        locale: z.string().describe("Target locale, one of the project's non-source locales"),
        entries: z
          .array(z.object({ key: z.string(), text: z.string() }))
          .describe('The translations, by catalog key'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Replace translations that already exist, for example outdated ones'),
      },
      outputSchema: {
        written: z.array(z.string()).describe('Saved as drafts, a human still has to approve them'),
        kept: z
          .array(z.string())
          .describe('Already translated, left as they were (overwrite replaces them)'),
        invalid: z
          .array(z.string())
          .describe('Rejected: empty, or the params, tags or plural cases were not preserved'),
        unknown: z.array(z.string()).describe('Not in the source catalog, so nothing was written'),
      },
      annotations: writes(true),
    },
    ctx.guarded(async ({ root, locale, entries, overwrite }) => {
      const cfg = await ctx.config(root);
      // checked against the text that ships, the one verbaly_missing reads it against
      const registry = await extractProject(cfg);
      const result = writeDrafts(cfg, locale, entries, { overwrite, registry });
      const lines: string[] = [];
      if (result.written.length > 0) {
        lines.push(`${locale}: +${result.written.length} saved as drafts, awaiting human review`);
      }
      if (result.kept.length > 0) {
        lines.push(
          `${locale}: ${result.kept.length} already translated, kept: ${result.kept.join(', ')}`,
        );
      }
      if (result.invalid.length > 0) {
        lines.push(
          `${locale}: ${result.invalid.length} rejected (params/tags not preserved): ${result.invalid.join(', ')}`,
        );
      }
      if (result.unknown.length > 0) {
        lines.push(
          `${locale}: ${counted(result.unknown.length, 'unknown key')} not in the source catalog: ${result.unknown.join(', ')}`,
        );
      }
      return reply(lines.length > 0 ? lines.join('\n') : 'nothing to save', { ...result });
    }),
  );
}
