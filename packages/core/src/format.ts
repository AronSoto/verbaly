import { dateTimeFormat, listFormat, numberFormat, pluralRules, relativeTimeFormat } from './intl';
import type { MessageNode, ParamNode } from './parse';
import type { Formatter, Params } from './types';
import { warnOnce } from './warn';

interface FormatContext {
  locale: string;
  params: Params | undefined;
  formatters: Record<string, Formatter>;
  hashValue?: unknown;
  key?: string;
}

export function formatNodes(nodes: MessageNode[], ctx: FormatContext): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') out += node.value;
    else if (node.kind === 'hash') out += autoFormat(ctx.hashValue, ctx.locale, ctx);
    else out += formatParam(node, ctx);
  }
  return out;
}

// every warn names its message: keying on the param alone silenced the second message with the gap
function where(ctx: FormatContext): string {
  return ctx.key ? ` in "${ctx.key}"` : '';
}

function formatParam(node: ParamNode, ctx: FormatContext): string {
  const value = ctx.params?.[node.name];
  if (value === undefined) {
    warnOnce(`missing param "${node.name}"${where(ctx)}`);
    return `{${node.name}}`;
  }

  if (node.variants) {
    const chosen = pickVariant(node.variants, value, ctx.locale, node.ordinal);
    // the value is left out of the warn on purpose: a counter walking 0..N must not grow the dedupe
    if (!chosen) {
      warnOnce(`no case matched for {${node.name}}${where(ctx)}, add an "other" case`);
      return '';
    }
    return formatNodes(chosen, { ...ctx, hashValue: value });
  }
  if (node.format) return applyFormat(value, node, ctx);
  return autoFormat(value, ctx.locale, ctx);
}

// the type of the offending value, never the value: the dedupe set must stay bounded
function describe(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'an invalid Date' : 'a Date';
  if (Array.isArray(value)) return 'an array';
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  return type === 'object' ? 'an object' : `a ${type}`;
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

function applyFormat(value: unknown, node: ParamNode, ctx: FormatContext): string {
  const { name, arg } = node;
  const format = node.format!;
  const custom = ctx.formatters[format];
  if (custom) return custom(value, ctx.locale, arg);

  const { locale } = ctx;
  // a format missing its argument degrades like an invalid one: with a warn, never in silence
  const degrade = (problem: string): string => {
    warnOnce(`{${name}:${format}}${where(ctx)} ${problem}`);
    return String(value);
  };

  switch (format) {
    case 'number':
      return numberFormat(locale).format(Number(value));
    case 'integer':
      return numberFormat(locale, { maximumFractionDigits: 0 }).format(Number(value));
    case 'percent':
      return numberFormat(locale, { style: 'percent' }).format(Number(value));
    case 'currency':
      if (!arg) return degrade('needs an argument like /USD');
      try {
        return numberFormat(locale, { style: 'currency', currency: arg }).format(Number(value));
      } catch {
        return degrade(`does not know the currency "${arg}"`);
      }
    case 'date':
      try {
        return dateTimeFormat(
          locale,
          arg ? { dateStyle: arg as Intl.DateTimeFormatOptions['dateStyle'] } : undefined,
        ).format(toDate(value));
      } catch {
        return degrade(`cannot format ${describe(value)}${arg ? ` with style "${arg}"` : ''}`);
      }
    case 'time':
      try {
        return dateTimeFormat(locale, {
          timeStyle: (arg ?? 'short') as Intl.DateTimeFormatOptions['timeStyle'],
        }).format(toDate(value));
      } catch {
        return degrade(`cannot format ${describe(value)} with style "${arg ?? 'short'}"`);
      }
    case 'relative':
      if (typeof value === 'number' && !arg) return degrade('needs an argument like /day');
      if (typeof value !== 'number' && !(value instanceof Date))
        return degrade('needs a number or a Date');
      return formatRelative(value, node, ctx);
    case 'list': {
      if (!Array.isArray(value)) return degrade('needs an array');
      const type = arg === 'or' ? 'disjunction' : arg === 'unit' ? 'unit' : 'conjunction';
      return listFormat(locale, type).format(value.map((item) => autoFormat(item, locale, ctx)));
    }
    case 'unit':
      if (!arg) return degrade('needs an argument like /kilometer');
      try {
        return numberFormat(locale, { style: 'unit', unit: arg }).format(Number(value));
      } catch {
        return degrade(`does not know the unit "${arg}"`);
      }
    default:
      return degrade('is not a format verbaly knows');
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

function formatRelative(value: number | Date, node: ParamNode, ctx: FormatContext): string {
  const { arg } = node;
  try {
    const fmt = relativeTimeFormat(ctx.locale);
    if (typeof value === 'number') return fmt.format(value, arg as Intl.RelativeTimeFormatUnit);
    const diffSec = (value.getTime() - Date.now()) / 1000;
    if (arg) {
      const per = REL_UNITS.find(([unit]) => unit === arg)?.[1];
      if (!per) throw new RangeError(arg);
      return fmt.format(Math.round(diffSec / per), arg as Intl.RelativeTimeFormatUnit);
    }
    const [unit, per] = REL_UNITS.find(([, s]) => Math.abs(diffSec) >= s) ?? ['second', 1];
    return fmt.format(Math.round(diffSec / per), unit);
  } catch {
    // an invalid Date lands here too, so the warn names both suspects instead of blaming the unit
    warnOnce(`{${node.name}:relative}${where(ctx)} cannot format ${describe(value)} as "${arg}"`);
    return String(value);
  }
}

export function autoFormat(value: unknown, locale: string, ctx?: FormatContext): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return numberFormat(locale).format(value);
  if (value instanceof Date) {
    // an invalid Date makes Intl throw: degrade like every other bad format input
    if (Number.isNaN(value.getTime())) {
      warnOnce(`an invalid Date${ctx ? where(ctx) : ''} renders as plain text`);
      return String(value);
    }
    return dateTimeFormat(locale).format(value);
  }
  return String(value);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}
