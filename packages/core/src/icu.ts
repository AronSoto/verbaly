import type { MessageNode, ParamNode } from './parse';

// ICU escape-hatch → native MessageNode AST
const ICU_ARG = /\{\s*[a-zA-Z0-9_]+\s*,\s*(?:plural|selectordinal|select|number|date|time)\b/;

export function isIcu(message: string): boolean {
  return ICU_ARG.test(message);
}

export function parseIcu(message: string): MessageNode[] {
  let i = 0;
  const at = (): string => message.charAt(i);
  const skipWs = (): void => {
    while (i < message.length && /\s/.test(at())) i++;
  };
  const readIdent = (): string => {
    let s = '';
    while (i < message.length && /[a-zA-Z0-9_]/.test(at())) s += message[i++];
    return s;
  };

  function parseBody(inPlural: boolean): MessageNode[] {
    const nodes: MessageNode[] = [];
    let buf = '';
    const flush = (): void => {
      if (buf) nodes.push({ kind: 'text', value: buf });
      buf = '';
    };
    while (i < message.length) {
      const ch = at();
      if (ch === '}') break;
      if (ch === '{') {
        flush();
        nodes.push(parseArg());
      } else if (ch === '#' && inPlural) {
        flush();
        nodes.push({ kind: 'hash' });
        i++;
      } else if (ch === "'") {
        buf += readQuoted();
      } else {
        buf += ch;
        i++;
      }
    }
    flush();
    return nodes;
  }

  // ICU apostrophe quoting
  function readQuoted(): string {
    i++; // opening '
    if (at() === "'") {
      i++;
      return "'";
    }
    const next = at();
    if (next !== '{' && next !== '}' && next !== '#') return "'"; // lone apostrophe
    let out = '';
    while (i < message.length) {
      if (at() === "'") {
        if (message.charAt(i + 1) === "'") {
          out += "'";
          i += 2;
          continue;
        }
        i++; // closing '
        return out;
      }
      out += message[i++];
    }
    return out; // unterminated
  }

  function parseArg(): MessageNode {
    i++; // {
    skipWs();
    const name = readIdent();
    skipWs();
    if (at() === '}') {
      i++;
      return { kind: 'param', name };
    }
    if (at() === ',') i++;
    skipWs();
    const type = readIdent();
    const node: ParamNode = { kind: 'param', name };

    if (type === 'number' || type === 'date' || type === 'time') {
      skipWs();
      let style = '';
      if (at() === ',') {
        i++;
        skipWs();
        while (i < message.length && at() !== '}' && at() !== ',') style += message[i++];
        style = style.trim();
      }
      if (type === 'number') {
        node.format =
          style === 'integer'
            ? 'integer'
            : style === 'percent'
              ? 'percent'
              : style === 'currency'
                ? 'currency'
                : 'number';
      } else {
        node.format = type;
        if (style) node.arg = style;
      }
      skipToClose();
      return node;
    }

    if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      if (type === 'selectordinal') node.ordinal = true;
      const variants: [string, MessageNode[]][] = [];
      skipWs();
      if (at() === ',') i++; // comma after the keyword
      skipWs();
      if (type !== 'select' && message.startsWith('offset:', i)) {
        i += 7;
        skipWs();
        while (i < message.length && /[0-9]/.test(at())) i++; // offset parsed, not applied (v1)
        skipWs();
      }
      while (i < message.length && at() !== '}') {
        const selector = readSelector();
        skipWs();
        if (at() !== '{') break;
        i++; // {
        const body = parseBody(type !== 'select');
        if (at() === '}') i++;
        variants.push([selector, body]);
        skipWs();
      }
      if (at() === '}') i++;
      node.variants = variants;
      return node;
    }

    // unknown type → simple param
    skipToClose();
    return node;
  }

  function readSelector(): string {
    if (at() === '=') {
      let s = '=';
      i++;
      while (i < message.length && /[0-9]/.test(at())) s += message[i++];
      return s;
    }
    let s = '';
    while (i < message.length && !/[\s{]/.test(at())) s += message[i++];
    return s;
  }

  function skipToClose(): void {
    while (i < message.length && at() !== '}') i++;
    if (at() === '}') i++;
  }

  return parseBody(false);
}
