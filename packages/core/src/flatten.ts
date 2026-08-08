import type { MessageTree } from './types';
import { warnOnce } from './warn';

export function flatten(
  tree: MessageTree,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  // a catalog is untrusted input: a lazy loader, addMessages or a CMS never crosses the build gate
  if (!isGroup(tree)) return out;
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else if (isGroup(value)) flatten(value, path, out);
    else warnOnce(`catalog value at "${path}" is not text, so the key renders as itself`);
  }
  return out;
}

function isGroup(value: unknown): value is MessageTree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
