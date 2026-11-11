import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { formatTranslateFailures, translateProject } from '@verbaly/compiler';
import { z } from 'zod';
import {
  byLocale,
  lockData,
  lockLine,
  lockOutput,
  perLocale,
  relativeTo,
  reply,
  rootInput,
  writes,
  type ToolContext,
} from './shared';

export function registerTranslate(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_translate',
    {
      title: 'Machine-translate missing entries',
      description:
        'Fill missing translations with the configured provider (what `verbaly translate` does). The default provider is Claude, which needs @anthropic-ai/sdk and ANTHROPIC_API_KEY. Every new translation is saved as a draft awaiting human review (`verbaly review`), which no tool here can approve. A batch the provider never answers is reported in failed and everything else stays written, so a retry only asks for what is left. dryRun lists what would be translated without calling the provider. To see what is missing first, use verbaly_missing; to save translations you wrote yourself, verbaly_write_drafts.',
      inputSchema: {
        root: rootInput,
        locales: z.array(z.string()).optional().describe('Target locales (default: all)'),
        dryRun: z
          .boolean()
          .optional()
          .describe('List missing entries per locale, call no provider'),
      },
      outputSchema: {
        dryRun: z.boolean(),
        translated: perLocale.describe('Saved as drafts, a human still has to approve them'),
        kept: perLocale.describe(
          'Written on disk by someone else while the provider worked, so left as they were',
        ),
        invalid: perLocale.describe('Rejected: params or tags were not preserved'),
        failed: z
          .array(z.object({ locale: z.string(), keys: z.array(z.string()), error: z.string() }))
          .describe('Batches the provider never answered, safe to retry'),
        pending: perLocale.describe('dryRun only: what would be translated'),
        lock: lockOutput,
      },
      annotations: writes(false, true),
    },
    ctx.guarded(async ({ root, locales, dryRun }) => {
      const cfg = await ctx.config(root);
      // the one run the CLI and Studio take: drafts, stamps and the lock move together
      const result = await translateProject(cfg, { locales, dryRun });

      if (dryRun) {
        const pending = byLocale(result.pending);
        const lines = pending.map(
          ({ locale, keys }) => `${locale}: ${keys.length} missing: ${keys.join(', ')}`,
        );
        const data = { dryRun: true, translated: [], kept: [], invalid: [], failed: [], pending };
        return reply(lines.length === 0 ? 'nothing to translate' : lines.join('\n'), data);
      }

      const data = {
        dryRun: false,
        translated: byLocale(result.written),
        kept: byLocale(result.kept),
        invalid: byLocale(result.invalid),
        failed: result.failed,
        pending: [],
        ...lockData(result.lock, relativeTo(cfg.root)),
      };
      const lines: string[] = [];
      for (const { locale, keys } of data.translated) {
        lines.push(`${locale}: +${keys.length} translated (draft)`);
      }
      for (const { locale, keys } of data.kept) {
        lines.push(`${locale}: ${keys.length} kept as written while this ran: ${keys.join(', ')}`);
      }
      for (const { locale, keys } of data.invalid) {
        lines.push(
          `${locale}: ${keys.length} rejected (params/tags not preserved): ${keys.join(', ')}`,
        );
      }
      lines.push(...formatTranslateFailures(result.failed));
      if (lines.length === 0) return reply('nothing to translate', data);
      lines.push(...lockLine(result.lock, cfg.root));
      if (data.translated.length > 0) {
        lines.push('drafts await human review: verbaly review (--approve accepts them)');
      }
      return reply(lines.join('\n'), data);
    }),
  );
}
