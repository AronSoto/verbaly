import { dateTimeFormat, numberFormat, pluralRules } from './intl';
import type { MessageNode, ParamNode } from './parse';
import type { Formatter, Params } from './types';

interface FormatContext {
  locale: string;
  params: Params | undefined;
  formatters: Record<string, Formatter>;
  hashValue?: unknown;
}

export function formatNodes(nodes: MessageNode[], ctx: FormatContext): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') out += node.value;
    else if (node.kind === 'hash') out += autoFormat(ctx.hashValue, ctx.locale);
    else out += formatParam(node, ctx);
  }
  return out;
}

function formatParam(node: ParamNode, ctx: FormatContext): string {
  const value = ctx.params?.[node.name];
  if (value === undefined) return `{${node.name}}`;

  if (node.variants) {
    const chosen = pickVariant(node.variants, value, ctx.locale);
    if (!chosen) return '';
    return formatNodes(chosen, { ...ctx, hashValue: value });
  }
  if (node.format) return applyFormat(value, node.format, node.arg, ctx);
  return autoFormat(value, ctx.locale);
}

function pickVariant(
  variants: [string, MessageNode[]][],
  value: unknown,
  locale: string,
): MessageNode[] | undefined {
  const raw = String(value);
  if (typeof value === 'number') {
    for (const [key, nodes] of variants) if (key === `=${raw}`) return nodes;
    const category = pluralRules(locale).select(value);
    for (const [key, nodes] of variants) if (key === category) return nodes;
  } else {
    for (const [key, nodes] of variants) if (key === raw) return nodes;
  }
  for (const [key, nodes] of variants) if (key === 'other') return nodes;
  return undefined;
}

function applyFormat(value: unknown, format: string, arg: string | undefined, ctx: FormatContext): string {
  const custom = ctx.formatters[format];
  if (custom) return custom(value, ctx.locale, arg);

  const { locale } = ctx;
  switch (format) {
    case 'number':
      return numberFormat(locale).format(Number(value));
    case 'integer':
      return numberFormat(locale, { maximumFractionDigits: 0 }).format(Number(value));
    case 'percent':
      return numberFormat(locale, { style: 'percent' }).format(Number(value));
    case 'currency':
      if (!arg) return String(value);
      return numberFormat(locale, { style: 'currency', currency: arg }).format(Number(value));
    case 'date':
      return dateTimeFormat(
        locale,
        arg ? { dateStyle: arg as Intl.DateTimeFormatOptions['dateStyle'] } : undefined,
      ).format(toDate(value));
    case 'time':
      return dateTimeFormat(locale, {
        timeStyle: (arg ?? 'short') as Intl.DateTimeFormatOptions['timeStyle'],
      }).format(toDate(value));
    default:
      return String(value);
  }
}

export function autoFormat(value: unknown, locale: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return numberFormat(locale).format(value);
  if (value instanceof Date) return dateTimeFormat(locale).format(value);
  return String(value);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}
