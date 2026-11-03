import { parseArgs } from 'node:util';

const OPTIONS = {
  root: { type: 'string' },
  dir: { type: 'string' },
  source: { type: 'string' },
  locales: { type: 'string' },
  prune: { type: 'boolean' },
  watch: { type: 'boolean' },
  write: { type: 'boolean' },
  json: { type: 'boolean' },
  drafts: { type: 'boolean' },
  outdated: { type: 'boolean' },
  draft: { type: 'boolean' },
  approve: { type: 'boolean' },
  reporter: { type: 'string' },
  model: { type: 'string' },
  locale: { type: 'string' },
  site: { type: 'string' },
  attribute: { type: 'string' },
  base: { type: 'string' },
  'base-url': { type: 'string' },
  redirect: { type: 'boolean' },
  sitemap: { type: 'boolean' },
  clean: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  plurals: { type: 'boolean' },
  format: { type: 'string' },
  out: { type: 'string' },
  missing: { type: 'boolean' },
  overwrite: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

export function parseCli(args: string[]) {
  return parseArgs({ args, allowPositionals: true, options: OPTIONS });
}

export type CliValues = ReturnType<typeof parseCli>['values'];

// "es, pt" is how a person types a list: a space must not become part of a locale
export function csv(value: string | undefined): string[] | undefined {
  return value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
