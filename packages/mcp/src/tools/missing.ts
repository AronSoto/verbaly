import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  check,
  effectiveDrafts,
  extractProject,
  formatCheckResult,
  formatCheckWarnings,
  loadCatalogs,
  loadState,
  readState,
} from '@verbaly/compiler';
import { z } from 'zod';
import {
  byLocale,
  perLocale,
  perLocaleEntries,
  READS,
  relativeCheck,
  reply,
  rootInput,
  sourceSite,
  type ToolContext,
} from './shared';

export function registerMissing(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_missing',
    {
      title: 'Missing and broken translations',
      description:
        'The gate `verbaly check` runs in CI, as lists: missing translations, unknown keys, keys written with two texts (collisions: every place shows the first text) and translations that cannot render what the source renders. A dropped {param}, a lost rich tag or a flattened plural block is that last kind. Warnings never fail the gate and are listed too: an incomplete plural set for the locale, keys only a translation has (extra), texts the code and the source catalog disagree on (divergent: the text in the code ships) and translations written for an older source text (outdated). With drafts set, it also lists the machine translations awaiting review. Read-only. For counts use verbaly_status, to review drafts with their source text verbaly_drafts, and for setup problems verbaly_doctor.',
      inputSchema: {
        root: rootInput,
        drafts: z
          .boolean()
          .optional()
          .describe('Also list machine translations awaiting human review'),
      },
      outputSchema: {
        ok: z.boolean().describe('Whether `verbaly check` would pass (warnings never fail it)'),
        missing: z.array(
          z.object({ locale: z.string(), key: z.string(), source: z.string().optional() }),
        ),
        unknown: z.array(z.object({ key: z.string(), files: z.array(z.string()) })),
        broken: z.array(
          z.object({
            locale: z.string(),
            key: z.string(),
            severity: z.enum(['error', 'warning']),
            issue: z.string(),
          }),
        ),
        extra: z
          .array(z.object({ locale: z.string(), key: z.string(), files: z.array(z.string()) }))
          .describe(
            'Keys only a translation has; files are where the code reads one, which the source language then shows as the key itself. Never fails the gate',
          ),
        collisions: z
          .array(z.object({ key: z.string(), sites: z.array(sourceSite) }))
          .describe(
            'One key, several texts: every place shows the first site, so it fails the gate. Give each text its own key',
          ),
        divergent: z
          .array(z.object({ key: z.string(), catalog: z.string(), code: sourceSite }))
          .describe(
            "The source catalog says one text and the code another: the code's text ships. Never fails the gate",
          ),
        outdated: perLocaleEntries.describe(
          'Translations written for an older source text: rewrite them, or a human keeps them with verbaly review --approve. Never fails the gate',
        ),
        unreviewed: perLocale,
        stateProblem: z
          .string()
          .optional()
          .describe('The state file could not be read, so outdated translations are not listed'),
      },
      annotations: READS,
    },
    ctx.guarded(async ({ root, drafts }) => {
      const cfg = await ctx.config(root);
      const registry = await extractProject(cfg);
      const catalogs = loadCatalogs(cfg);
      // asked for drafts, the state has to be readable; otherwise it only feeds a warning
      const { state, problem } = drafts
        ? { state: loadState(cfg), problem: undefined }
        : readState(cfg);
      const result = check(cfg, catalogs, registry, state.fingerprints);
      const unreviewed = drafts ? byLocale(effectiveDrafts(state.drafts, catalogs)) : [];

      const lines: string[] = [];
      if (!result.ok) lines.push(formatCheckResult(result, cfg.root));
      const warnings = formatCheckWarnings(result, cfg.root);
      if (warnings) lines.push(`warnings (the gate still passes):\n${warnings}`);
      for (const { locale, keys } of unreviewed) {
        if (keys.length) lines.push(`[${locale}] ${keys.length} unreviewed: ${keys.join(', ')}`);
      }
      if (problem) lines.push(`${problem}, so outdated translations are not listed`);
      return reply(lines.length === 0 ? 'all translations complete' : lines.join('\n'), {
        ...relativeCheck(cfg.root, result),
        unreviewed,
        ...(problem && { stateProblem: problem }),
      });
    }),
  );
}
