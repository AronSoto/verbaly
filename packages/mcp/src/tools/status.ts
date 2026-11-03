import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  extractProject,
  formatStatusResult,
  loadCatalogs,
  readState,
  status,
} from '@verbaly/compiler';
import { z } from 'zod';
import { READS, reply, rootInput, type ToolContext } from './shared';

export function registerStatus(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_status',
    {
      title: 'Translation coverage',
      description:
        'Translation coverage of the Verbaly project as numbers per locale: total messages, translated, machine translations awaiting review (drafts), broken, and translations written for an older source text (outdated). It scans the source like verbaly_extract but writes nothing. Read-only. For the entries behind the numbers, use verbaly_missing (what is missing or broken) or verbaly_drafts (each draft with its source text).',
      inputSchema: { root: rootInput },
      outputSchema: {
        messages: z.number().describe('Messages the project has, source catalog plus code'),
        source: z.string().describe('Source locale'),
        locales: z.array(
          z.object({
            locale: z.string(),
            translated: z.number(),
            total: z.number(),
            drafts: z.number().describe('Machine translations awaiting human review'),
            broken: z.number().describe('Present but not rendering what the source renders'),
            outdated: z
              .number()
              .describe('Translated from an older source text: update them, or a human keeps them'),
          }),
        ),
        stateProblem: z
          .string()
          .optional()
          .describe('The state file could not be read, so drafts and outdated are counted as zero'),
      },
      annotations: READS,
    },
    ctx.guarded(async ({ root }) => {
      const cfg = await ctx.config(root);
      const registry = await extractProject(cfg);
      // the state only feeds two counts: a broken one is said, never a failed call
      const { state, problem } = readState(cfg);
      const result = status(cfg, loadCatalogs(cfg), registry, state.drafts, state.fingerprints);
      const body = formatStatusResult(result);
      return reply(problem ? `${body}\n${problem}, so drafts and outdated are not counted` : body, {
        ...result,
        ...(problem && { stateProblem: problem }),
      });
    }),
  );
}
