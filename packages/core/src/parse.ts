import { isIcu } from './icu';
import { warnOnce } from './warn';

export type MessageNode = { kind: 'text'; value: string } | { kind: 'hash' } | ParamNode;

export interface ParamNode {
  kind: 'param';
  name: string;
  format?: string;
  arg?: string;
  ordinal?: boolean;
  variants?: [string, MessageNode[]][];
}

const astCache = new Map<string, MessageNode[]>();
const AST_CACHE_MAX = 5000; // dynamic/CMS messages can't grow it unbounded

// ICU is the escape hatch, so its parser is a passenger the app opts into rather than always ships
export type IcuParser = (message: string) => MessageNode[];

export function parse(message: string, icu?: IcuParser): MessageNode[] {
  let cached = astCache.get(message);
  if (!cached) {
    if (isIcu(message)) {
      // an unparsed ICU message is not cached: the app is misconfigured, not settled
      if (!icu) return unparsedIcu(message);
      cached = icu(message);
    } else {
      cached = parseMessage(message, false);
    }
    // drop the oldest, never the whole map: clearing threw away the hot set on every overflow
    if (astCache.size >= AST_CACHE_MAX) astCache.delete(astCache.keys().next().value as string);
    astCache.set(message, cached);
  }
  return cached;
}

// visible and named, never a plausible-looking wrong render: the source shows and the warn says why
function unparsedIcu(message: string): MessageNode[] {
  warnOnce(
    'a message uses ICU syntax but no ICU parser is loaded: pass icu to createVerbaly (the ' +
      'compiler wires it when a catalog needs it, so this means it arrived after the build)',
  );
  return [{ kind: 'text', value: message }];
}

function parseMessage(input: string, inVariant: boolean): MessageNode[] {
  const nodes: MessageNode[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) nodes.push({ kind: 'text', value: buf });
    buf = '';
  };

  while (i < input.length) {
    const ch = input[i];
    if (ch === '{') {
      if (input[i + 1] === '{') {
        buf += '{';
        i += 2;
        continue;
      }
      const close = findClose(input, i);
      if (close < 0) {
        buf += input.slice(i);
        break;
      }
      flush();
      nodes.push(parsePlaceholder(input.slice(i + 1, close)));
      i = close + 1;
    } else if (ch === '}' && input[i + 1] === '}') {
      buf += '}';
      i += 2;
    } else if (inVariant && ch === '#') {
      if (input[i + 1] === '#') {
        buf += '#';
        i += 2;
      } else {
        flush();
        nodes.push({ kind: 'hash' });
        i += 1;
      }
    } else {
      buf += ch;
      i += 1;
    }
  }
  flush();
  return nodes;
}

function findClose(input: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '{') {
      if (input[i + 1] === '{') {
        i += 2;
        continue;
      }
      depth += 1;
    } else if (ch === '}') {
      if (input[i + 1] === '}') {
        i += 2;
        continue;
      }
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function parsePlaceholder(inner: string): MessageNode {
  const segments = splitTop(inner);
  const head = (segments[0] ?? '').trim();
  if (!head) return { kind: 'text', value: `{${inner}}` };

  const colon = head.indexOf(':');
  const name = (colon < 0 ? head : head.slice(0, colon)).trim();
  if (!name) return { kind: 'text', value: `{${inner}}` };

  const node: ParamNode = { kind: 'param', name };

  if (colon >= 0) {
    const fmtRaw = head.slice(colon + 1).trim();
    const slash = fmtRaw.indexOf('/');
    node.format = (slash < 0 ? fmtRaw : fmtRaw.slice(0, slash)).trim();
    if (slash >= 0) node.arg = fmtRaw.slice(slash + 1).trim();
  }

  if (segments.length > 1) {
    node.variants = [];
    for (const seg of segments.slice(1)) {
      const sep = seg.indexOf(':');
      if (sep < 0) continue;
      const key = seg.slice(0, sep).trim();
      const body = seg.slice(sep + 1).trim();
      if (key) node.variants.push([key, parseMessage(body, true)]);
    }
  }
  return node;
}

function splitTop(input: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === '{') {
      if (input[i + 1] === '{') {
        buf += '{{';
        i += 2;
        continue;
      }
      depth += 1;
      buf += ch;
    } else if (ch === '}') {
      if (input[i + 1] === '}') {
        buf += '}}';
        i += 2;
        continue;
      }
      depth -= 1;
      buf += ch;
    } else if (ch === '|' && depth === 0) {
      if (input[i + 1] === '|') {
        buf += '|';
        i += 2;
        continue;
      }
      parts.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
    i += 1;
  }
  parts.push(buf);
  return parts;
}
