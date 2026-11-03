import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { counted, doctor, formatDoctorEntry, formatDoctorHealth } from '@verbaly/compiler';
import { z } from 'zod';
import { READS, reply, rootInput, type ToolContext } from './shared';

export function registerDoctor(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_doctor',
    {
      title: 'Diagnose the setup',
      description:
        'Diagnose a Verbaly project end to end (what `verbaly doctor` does). It checks the config file, the catalogs and their JSON, the bundler plugin for the detected framework, the generated types, files the parser could not read, a t imported from a package that never exports it, orphan keys, and every failure `verbaly check` would report, and it reports them all at once instead of stopping at the first. Run it first when something does not work. Read-only. For the missing or broken translations themselves, use verbaly_missing.',
      inputSchema: { root: rootInput },
      outputSchema: {
        ok: z.boolean().describe('False when an entry is an error, which is when the CLI exits 1'),
        entries: z.array(
          z.object({
            level: z.enum(['ok', 'warn', 'error']),
            check: z.string(),
            message: z.string(),
            fix: z.string().optional().describe('What to run or change, when there is one'),
          }),
        ),
      },
      annotations: READS,
    },
    ctx.guarded(async ({ root }) => {
      const cfg = await ctx.config(root);
      const result = await doctor(cfg);
      const head = `${counted(result.entries.length, 'check')}, ${formatDoctorHealth(result)}`;
      return reply([head, ...result.entries.map(formatDoctorEntry)].join('\n'), { ...result });
    }),
  );
}
