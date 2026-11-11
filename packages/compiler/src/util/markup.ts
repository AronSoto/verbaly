export interface Attribute {
  value: string;
  // where the value sits in the chunk, quotes included; both are the name's end when it has none
  start: number;
  end: number;
}

const NAME = `[^\\s=/"'<>]+`;
const ATTRIBUTE = new RegExp(`(${NAME})(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'g');
const ATTRIBUTE_NAME = new RegExp(`^${NAME}$`);

// what a start tag holds after its name: a > between quotes belongs to the value
export const TAG_REST = `(?:"[^"]*"|'[^']*'|[^"'>])*`;

export function isAttributeName(name: string): boolean {
  return ATTRIBUTE_NAME.test(name);
}

// the one reader of a tag's attributes, html or xml: the first of a name wins, as a browser reads
export function readAttributes(chunk: string, lowerCase = false): Map<string, Attribute> {
  const attributes = new Map<string, Attribute>();
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(chunk)) !== null) {
    const name = lowerCase ? match[1]!.toLowerCase() : match[1]!;
    if (attributes.has(name)) continue;
    const quoted = match[2] ?? match[3];
    const value = quoted ?? match[4] ?? '';
    const end = match.index + match[0].length;
    const written = quoted !== undefined ? value.length + 2 : value.length;
    attributes.set(name, { value, start: end - written, end });
  }
  return attributes;
}

const ENTITY = /&(?:(lt|gt|amp|quot|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g;
const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

// one pass, so &amp;lt; stays the text it spells; a number that is no code point stays as written
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, name?: string, decimal?: string, hex?: string) => {
    if (name) return NAMED[name]!;
    const code = decimal ? parseInt(decimal, 10) : parseInt(hex!, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
