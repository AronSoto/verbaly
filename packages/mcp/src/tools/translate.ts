import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  collectOrigins,
  extractProject,
  formatTranslateFailures,
  loadCatalogs,
  loadState,
  mergeTranslations,
  recordTranslations,
  resolveProvider,
  shippedCatalogs,
  translateCatalogs,
  type TranslationWrite,
} from '@verbaly/compiler';
import { z } from 'zod';
import { byLocale, perLocale, reply, rootInput, writes, type ToolContext } from './shared';

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
      },
      annotations: writes(false, true),
    },
    ctx.guarded(async ({ root, locales, dryRun }) => {
      const cfg = await ctx.config(root);
      // a machine translation that lost its draft flag passes as reviewed: read the state first
      if (!dryRun) loadState(cfg);
      const registry = await extractProject(cfg);
      // the provider reads the text that ships, which is the text its answer has to match
      const catalogs = shippedCatalogs(cfg, loadCatalogs(cfg), registry, { newKeys: false });
      const provider = await resolveProvider(cfg);
      const result = await translateCatalogs(cfg, catalogs, provider, {
        locales,
        batchSize: cfg.translate.batchSize,
        concurrency: cfg.translate.concurrency,
        retries: cfg.translate.retries,
        dryRun,
        origins: dryRun ? undefined : await collectOrigins(cfg, registry),
      });

      if (dryRun) {
        const pending = byLocale(result.pending);
        const lines = pending.map(
          ({ locale, keys }) => `${locale}: ${keys.length} missing: ${keys.join(', ')}`,
        );
        const data = { dryRun: true, translated: [], kept: [], invalid: [], failed: [], pending };
        return reply(lines.length === 0 ? 'nothing to translate' : lines.join('\n'), data);
      }

      // the file as it is now: what someone wrote while the provider worked is not overwritten
      const written: Array<{ locale: string; keys: string[] }> = [];
      const kept: Array<{ locale: string; keys: string[] }> = [];
      const writes: TranslationWrite[] = [];
      for (const [locale, keys] of Object.entries(result.translated)) {
        const catalog = catalogs[locale] ?? {};
        const landed = mergeTranslations(cfg, locale, catalog, keys);
        writes.push({
          locale,
          draft: true,
          entries: landed.map((key) => ({ key, text: catalog[key]! })),
        });
        if (landed.length > 0) written.push({ locale, keys: landed });
        const left = keys.filter((key) => !landed.includes(key));
        if (left.length > 0) kept.push({ locale, keys: left });
      }
      if (writes.length > 0) recordTranslations(cfg, catalogs[cfg.sourceLocale] ?? {}, writes);

      const data = {
        dryRun: false,
        translated: written,
        kept,
        invalid: byLocale(result.invalid),
        failed: result.failed,
        pending: [],
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
      if (data.translated.length > 0) {
        lines.push('drafts await human review: verbaly review (--approve accepts them)');
      }
      return reply(lines.join('\n'), data);
    }),
  );
}
