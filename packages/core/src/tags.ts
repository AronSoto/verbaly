// Named-tag tokenizer for <Trans>
export type TagNode = string | { name: string; children: TagNode[] };

const TAG = /<(\/?)([a-zA-Z][\w-]*)(\/?)>/g;

// text runs only, post-tokenize: decoded braces/angles never re-enter a parser
const ENTITY = /&(?:(lt|gt|amp)|#(\d+)|#[xX]([0-9a-fA-F]+));/g;
const ENTITY_MAP: Record<string, string> = { lt: '<', gt: '>', amp: '&' };
const decodeEntities = (s: string): string =>
  s.replace(ENTITY, (full, name?: string, dec?: string, hex?: string) => {
    if (name) return ENTITY_MAP[name]!;
    const code = dec ? parseInt(dec, 10) : parseInt(hex!, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : full;
  });

export function parseTags(text: string): TagNode[] {
  TAG.lastIndex = 0;
  const root: TagNode[] = [];
  const stack: { name: string; children: TagNode[] }[] = [];
  const top = (): TagNode[] => (stack.length ? stack[stack.length - 1]!.children : root);
  const pushText = (s: string): void => {
    if (s) top().push(decodeEntities(s));
  };

  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(text)) !== null) {
    const [full, closing, name, selfClose] = m;
    pushText(text.slice(last, m.index));
    last = m.index + full.length;

    if (selfClose) {
      top().push({ name: name!, children: [] });
    } else if (closing) {
      if (stack.length && stack[stack.length - 1]!.name === name) {
        const node = stack.pop()!;
        top().push(node);
      } else {
        pushText(full); // stray closing tag → literal
      }
    } else {
      stack.push({ name: name!, children: [] });
    }
  }
  pushText(text.slice(last));

  // unclosed opens: drop wrapper
  while (stack.length) {
    const node = stack.pop()!;
    top().push(...node.children);
  }
  return root;
}
