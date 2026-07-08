import { dateTimeFormat, listFormat, numberFormat, pluralRules, relativeTimeFormat } from './intl';
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
    const chosen = pickVariant(node.variants, value, ctx.locale, node.ordinal);
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
  ordinal?: boolean,
): MessageNode[] | undefined {
  const raw = String(value);
  if (typeof value === 'number') {
    for (const [key, nodes] of variants) if (key === `=${raw}`) return nodes;
    const category = pluralRules(locale, ordinal ? 'ordinal' : 'cardinal').select(value);
    for (const [key, nodes] of variants) if (key === category) return nodes;
  } else {
    for (const [key, nodes] of variants) if (key === raw) return nodes;
  }
  for (const [key, nodes] of variants) if (key === 'other') return nodes;
  return undefined;
}

function applyFormat(
  value: unknown,
  format: string,
  arg: string | undefined,
  ctx: FormatContext,
): string {
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
    case 'relative':
      return formatRelative(value, arg, locale);
    case 'list': {
      if (!Array.isArray(value)) return String(value);
      const type = arg === 'or' ? 'disjunction' : arg === 'unit' ? 'unit' : 'conjunction';
      return listFormat(locale, type).format(value.map((item) => autoFormat(item, locale)));
    }
    case 'unit':
      if (!arg) return String(value);
      try {
        return numberFormat(locale, { style: 'unit', unit: arg }).format(Number(value));
      } catch {
        warnOnce(`invalid unit "${arg}"`);
        return String(value);
      }
    default:
      warnOnce(`unknown format "${format}"`);
      return String(value);
  }
}

// seconds per unit, largest first (auto pick)
const REL_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

function formatRelative(value: unknown, arg: string | undefined, locale: string): string {
  try {
    if (typeof value === 'number' && arg) {
      return relativeTimeFormat(locale).format(value, arg as Intl.RelativeTimeFormatUnit);
    }
    if (value instanceof Date) {
      const diffSec = (value.getTime() - Date.now()) / 1000;
      if (arg) {
        const per = REL_UNITS.find(([unit]) => unit === arg)?.[1];
        if (!per) throw new RangeError(arg);
        return relativeTimeFormat(locale).format(
          Math.round(diffSec / per),
          arg as Intl.RelativeTimeFormatUnit,
        );
      }
      const [unit, per] = REL_UNITS.find(([, s]) => Math.abs(diffSec) >= s) ?? ['second', 1];
      return relativeTimeFormat(locale).format(Math.round(diffSec / per), unit);
    }
  } catch {
    warnOnce(`invalid relative unit "${arg}"`);
  }
  return String(value);
}

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[verbaly] ${msg}`);
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
