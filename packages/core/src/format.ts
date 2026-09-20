import { dateTimeFormat, listFormat, numberFormat, pluralRules } from './intl';
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
  // NaN is typeof number, and "cannot format a number as a number" names nothing
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
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

const NUMERIC = /^(number|integer|percent|currency|unit)$/;

function applyFormat(value: unknown, node: ParamNode, ctx: FormatContext): string {
  const { name, arg } = node;
  const format = node.format!;
  const custom = ctx.formatters[format];
  if (custom) return custom(value, ctx.locale, arg, { param: name, key: ctx.key });

  const { locale } = ctx;
  // what arrived, kept because the numeric guard below replaces value with the parsed number
  const raw = value;
  // a format missing its argument degrades like an invalid one: with a warn, never in silence
  const degrade = (problem: string): string => {
    warnOnce(`{${name}:${format}}${where(ctx)} ${problem}`);
    return String(raw);
  };
  // what a number is gets decided once: Intl prints NaN instead of throwing, and Number(null) is 0
  if (NUMERIC.test(format)) {
    const n = value === null || value === '' ? NaN : Number(value);
    if (Number.isNaN(n)) return degrade(`cannot format ${describe(value)} as a number`);
    value = n;
  }

  switch (format) {
    case 'number':
      return numberFormat(locale).format(value as number);
    case 'integer':
      return numberFormat(locale, { maximumFractionDigits: 0 }).format(value as number);
    case 'percent':
      return numberFormat(locale, { style: 'percent' }).format(value as number);
    case 'currency':
      if (!arg) return degrade('needs an argument like /USD');
      try {
        return numberFormat(locale, { style: 'currency', currency: arg }).format(value as number);
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
    case 'list': {
      if (!Array.isArray(value)) return degrade('needs an array');
      const type = arg === 'or' ? 'disjunction' : arg === 'unit' ? 'unit' : 'conjunction';
      return listFormat(locale, type).format(value.map((item) => autoFormat(item, locale, ctx)));
    }
    case 'unit':
      if (!arg) return degrade('needs an argument like /kilometer');
      try {
        return numberFormat(locale, { style: 'unit', unit: arg }).format(value as number);
      } catch {
        return degrade(`does not know the unit "${arg}"`);
      }
    // known but not loaded reads nothing like unknown, and the fix is not the reader's to guess
    case 'relative':
      return degrade('is not loaded: the compiler wires it when a catalog message uses it');
    default:
      return degrade('is not a format verbaly knows');
  }
}

export function autoFormat(value: unknown, locale: string, ctx?: FormatContext): string {
  if (value === null || value === undefined) return '';
  // an invalid Date makes Intl throw and NaN makes it print "NaN": one degradation, one report
  if (Number.isNaN(value instanceof Date ? value.getTime() : value)) {
    warnOnce(`${describe(value)}${ctx ? where(ctx) : ''} renders as plain text`);
    return String(value);
  }
  if (typeof value === 'number') return numberFormat(locale).format(value);
  if (value instanceof Date) return dateTimeFormat(locale).format(value);
  return String(value);
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(value as string | number);
}
