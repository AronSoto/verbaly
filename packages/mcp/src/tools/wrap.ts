import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { counted, wrapProject } from '@verbaly/compiler';
import { z } from 'zod';
import { reply, rootInput, writes, type ToolContext } from './shared';

export function registerWrap(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'verbaly_wrap',
    {
      title: 'Wrap hardcoded JSX text',
      description:
        'Find hardcoded user-visible text in JSX/TSX files and wrap it in a t tagged template so the compiler can extract it (what `verbaly wrap` does). This is how an existing codebase is onboarded, and verbaly_extract then adds the wrapped texts to the catalogs. It only reports unless write is set, and text already wrapped is skipped, so running it again is safe. Text it cannot wrap safely (a sentence split across markup, an expression rendering JSX) is listed as needing a human. A file that does not bind t is never written, because the rewrite would not compile. It comes back in blocked, with the binding this project needs there, so you can add it and run again.',
      inputSchema: {
        root: rootInput,
        write: z.boolean().optional().describe('Apply the rewrites instead of only reporting'),
      },
      outputSchema: {
        files: z.number().describe('JSX/TSX files scanned'),
        write: z.boolean(),
        changed: z.array(z.string()).describe('Files the rewrite touched, or would touch'),
        wrapped: z.array(
          z.object({
            file: z.string(),
            line: z.number(),
            text: z.string(),
            kind: z.enum(['text', 'attribute']),
            attribute: z.string().optional(),
          }),
        ),
        skipped: z.array(
          z.object({ file: z.string(), line: z.number(), text: z.string(), reason: z.string() }),
        ),
        blocked: z.array(
          z.object({
            file: z.string(),
            texts: z.number(),
            client: z.boolean(),
            binding: z.string().describe('What to add so t is in scope, for this framework'),
          }),
        ),
      },
      annotations: writes(true),
    },
    ctx.guarded(async ({ root, write }) => {
      const cfg = await ctx.config(root);
      const result = await wrapProject(cfg, { write });
      const blocked = new Set(result.blocked.map((entry) => entry.file));
      const done = result.changed.filter((file) => !blocked.has(file));
      const texts = result.wrapped.filter((entry) => !blocked.has(entry.file));
      const verb = write ? 'wrapped' : 'would wrap';
      const counts = write
        ? `${counted(texts.length, 'text')} in ${counted(done.length, 'file')}`
        : `${counted(result.wrapped.length, 'text')} in ${counted(result.changed.length, 'file')}`;
      const lines = [`${verb} ${counts} of ${counted(result.files, 'file')} scanned`];
      for (const entry of write ? texts : result.wrapped) {
        const attr = entry.kind === 'attribute' ? `${entry.attribute} -> ` : '';
        lines.push(`  ${entry.file}:${entry.line}  ${attr}"${entry.text}"`);
      }
      if (result.skipped.length > 0) {
        lines.push('  needs a human:');
        for (const entry of result.skipped) {
          lines.push(`  ${entry.file}:${entry.line}  "${entry.text}" (${entry.reason})`);
        }
      }
      if (result.blocked.length > 0) {
        lines.push(
          `  nothing written in ${counted(result.blocked.length, 'file')} with no t in scope:`,
        );
        for (const entry of result.blocked) {
          lines.push(`  ${entry.file}  ${counted(entry.texts, 'text')}, ${entry.binding}`);
        }
        lines.push('  next: bind t there, run verbaly_wrap with write again, then verbaly_extract');
      } else if (write && done.length > 0) {
        lines.push('  next: run verbaly_extract');
      }
      return reply(lines.join('\n'), { ...result, write: write === true });
    }),
  );
}
