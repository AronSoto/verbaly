import { parse, type MessageNode } from 'verbaly';
import { PLURAL_CATEGORIES } from './validate';

export type ParamType = 'number' | 'string' | 'date' | 'unknown';

const NUMBER_FORMATS = new Set(['number', 'integer', 'percent', 'currency']);
const DATE_FORMATS = new Set(['date', 'time']);

export function collectParams(message: string): Map<string, Set<ParamType>> {
  const out = new Map<string, Set<ParamType>>();
  visit(parse(message), out);
  return out;
}

function visit(nodes: MessageNode[], out: Map<string, Set<ParamType>>): void {
  for (const node of nodes) {
    if (node.kind !== 'param') continue;
    const types = out.get(node.name) ?? new Set<ParamType>();
    out.set(node.name, types);

    if (node.variants) {
      for (const [key, body] of node.variants) {
        if (PLURAL_CATEGORIES.has(key) || /^=\d+$/.test(key)) types.add('number');
        else if (key !== 'other') types.add('string');
        visit(body, out);
      }
      if (types.size === 0) types.add('string');
    } else if (node.format && NUMBER_FORMATS.has(node.format)) {
      types.add('number');
    } else if (node.format && DATE_FORMATS.has(node.format)) {
      types.add('date');
    } else {
      types.add('unknown');
    }
  }
}

export function renderParamType(types: Set<ParamType>): string {
  if (types.has('unknown') || types.size === 0) return 'unknown';
  const members = new Set<string>();
  if (types.has('number')) members.add('number');
  if (types.has('string')) members.add('string');
  if (types.has('date')) for (const m of ['Date', 'number', 'string']) members.add(m);
  return [...members].join(' | ');
}
