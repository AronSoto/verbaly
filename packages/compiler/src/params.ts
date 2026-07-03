import { parse, type MessageNode } from 'verbaly';

export type ParamType = 'number' | 'string' | 'date' | 'unknown';

const PLURAL_KEYS = new Set(['zero', 'one', 'two', 'few', 'many']);
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
        if (PLURAL_KEYS.has(key) || /^=\d+$/.test(key)) types.add('number');
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
  const parts: string[] = [];
  if (types.has('number')) parts.push('number');
  if (types.has('string')) parts.push('string');
  if (types.has('date')) parts.push('Date | number | string');
  return parts.join(' | ');
}
