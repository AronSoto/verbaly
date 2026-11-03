import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { CheckResult, Finding, ResolvedConfig } from '@verbaly/compiler';
import { relative } from 'node:path';
import { z } from 'zod';

// what every tool gets from the server that registers it
export interface ToolContext {
  root: string | undefined;
  config: (root?: string) => Promise<ResolvedConfig>;
  guarded: <A>(run: (args: A) => Promise<CallToolResult>) => (args: A) => Promise<CallToolResult>;
}

// text stays the fallback for a client that reads no schema, structuredContent is what agents parse
export const reply = (body: string, data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: body }],
  structuredContent: data,
});

// a client that gets no hints must assume the spec defaults: destructive and reaching the internet
export const READS = { readOnlyHint: true, openWorldHint: false } as const;
export function writes(destructiveHint: boolean, openWorldHint = false) {
  // every writer here is safe to repeat, which a second call in the tests proves
  return { readOnlyHint: false, destructiveHint, idempotentHint: true, openWorldHint };
}

export const rootInput = z
  .string()
  .optional()
  .describe('Project root holding verbaly.config (defaults to the server working directory)');

export const perLocale = z.array(z.object({ locale: z.string(), keys: z.array(z.string()) }));

export const perLocaleEntries = z.array(z.object({ locale: z.string(), key: z.string() }));

// a locale-keyed record is a dynamic schema an agent cannot read ahead: lists enumerate
export const byLocale = (
  record: Record<string, string[]>,
): Array<{ locale: string; keys: string[] }> =>
  Object.entries(record).map(([locale, keys]) => ({ locale, keys }));

export const sourceSite = z.object({
  file: z.string(),
  line: z.number().optional(),
  message: z.string(),
});

// an agent reads paths against the project, the same way every tool here writes them
export function relativeTo(root: string): (file: string) => string {
  return (file) => relative(root, file).replaceAll('\\', '/');
}

// the lock a run created, moved in or merged, the one thing an agent has to tell its user to commit
export function lockOf(
  findings: Finding[],
  rel: (file: string) => string,
): { lock?: { file: string; from?: string; merged?: boolean } } {
  for (const finding of findings) {
    if (finding.kind !== 'lock') continue;
    const from = finding.from && { from: rel(finding.from) };
    return { lock: { file: rel(finding.file), ...from, ...(finding.merged && { merged: true }) } };
  }
  return {};
}

export function relativeCheck(root: string, result: CheckResult): CheckResult {
  const rel = relativeTo(root);
  return {
    ...result,
    unknown: result.unknown.map((entry) => ({ ...entry, files: entry.files.map(rel) })),
    extra: result.extra.map((entry) => ({ ...entry, files: entry.files.map(rel) })),
    collisions: result.collisions.map((entry) => ({
      ...entry,
      sites: entry.sites.map((at) => ({ ...at, file: rel(at.file) })),
    })),
    divergent: result.divergent.map((entry) => ({
      ...entry,
      code: { ...entry.code, file: rel(entry.code.file) },
    })),
  };
}
