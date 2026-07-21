// XLIFF 2.0 inline codes: simple {params} export as <ph>, paired rich tags as <pc>,
// with semantic ids (the param/tag name) so TMS editors protect them as chips instead
// of exposing raw syntax. disp carries the exact source slice: decoding reconstructs
// the message verbatim, so the round-trip is lossless. Variant params ({v | one: …})
// hold translatable text and stay raw on purpose.

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'ph'; name: string; src: string }
  | { kind: 'pc'; name: string; openSrc: string; closeSrc: string; children: Part[] };

const OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)\s*(\/?)>/;

export function messageToInline(text: string): string {
  const parsed = parseParts(text, 0);
  return renderParts(parsed.parts, new Map());
}

export function inlineToMessage(xml: string): string {
  let out = '';
  let text = '';
  let i = 0;
  const flush = () => {
    out += unescapeXml(text);
    text = '';
  };
  while (i < xml.length) {
    if (xml[i] === '<') {
      const slice = xml.slice(i);
      const ph = /^<ph\b([^>]*?)\/\s*>/.exec(slice) ?? /^<ph\b([^>]*)>\s*<\/ph\s*>/.exec(slice);
      if (ph) {
        flush();
        out += attr(ph[1]!, 'disp') ?? `{${attr(ph[1]!, 'id') ?? 'ph'}}`;
        i += ph[0].length;
        continue;
      }
      const pc = /^<pc\b([^>]*)>/.exec(slice);
      if (pc) {
        const close = findPcClose(xml, i + pc[0].length);
        if (close) {
          flush();
          const id = attr(pc[1]!, 'id') ?? 'pc';
          out += attr(pc[1]!, 'dispStart') ?? `<${id}>`;
          out += inlineToMessage(xml.slice(i + pc[0].length, close.innerEnd));
          out += attr(pc[1]!, 'dispEnd') ?? `</${id}>`;
          i = close.end;
          continue;
        }
      }
    }
    text += xml[i];
    i += 1;
  }
  flush();
  return out;
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function unescapeXml(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#x?[0-9a-fA-F]+);/g, (_, entity: string) => {
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'amp') return '&';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const code = entity.startsWith('#x')
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

interface ParsedParts {
  parts: Part[];
  end: number;
  closed: boolean;
}

function parseParts(text: string, pos: number, closeTag?: string): ParsedParts {
  const parts: Part[] = [];
  let plain = '';
  const flush = () => {
    if (plain) parts.push({ kind: 'text', text: plain });
    plain = '';
  };
  let i = pos;
  while (i < text.length) {
    const pair = text[i]! + (text[i + 1] ?? '');
    if (pair === '{{' || pair === '}}') {
      plain += pair;
      i += 2;
      continue;
    }
    if (text[i] === '{') {
      const end = matchBrace(text, i);
      if (end === -1) {
        plain += '{';
        i += 1;
        continue;
      }
      const src = text.slice(i, end + 1);
      if (hasTopLevelPipe(src)) {
        plain += src;
      } else {
        flush();
        parts.push({ kind: 'ph', name: paramName(src), src });
      }
      i = end + 1;
      continue;
    }
    if (text[i] === '<') {
      if (closeTag && text.startsWith(`</${closeTag}>`, i)) {
        flush();
        return { parts, end: i + closeTag.length + 3, closed: true };
      }
      const open = OPEN_TAG.exec(text.slice(i));
      if (open) {
        const [openSrc, name, selfClose] = open as unknown as [string, string, string];
        if (selfClose) {
          flush();
          parts.push({ kind: 'ph', name: idSafe(name), src: openSrc });
          i += openSrc.length;
          continue;
        }
        const inner = parseParts(text, i + openSrc.length, name);
        if (inner.closed) {
          flush();
          parts.push({
            kind: 'pc',
            name: idSafe(name),
            openSrc,
            closeSrc: `</${name}>`,
            children: inner.parts,
          });
          i = inner.end;
          continue;
        }
      }
      // no closing tag ahead: keep the '<' as plain text
      plain += '<';
      i += 1;
      continue;
    }
    plain += text[i];
    i += 1;
  }
  flush();
  return { parts, end: i, closed: false };
}

function matchBrace(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const pair = text[i]! + (text[i + 1] ?? '');
    if (pair === '{{' || pair === '}}') {
      i += 1;
      continue;
    }
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// a top-level pipe means variants (plural/select): their bodies are translatable
function hasTopLevelPipe(src: string): boolean {
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const pair = src[i]! + (src[i + 1] ?? '');
    if (pair === '{{' || pair === '}}' || pair === '||') {
      i += 1;
      continue;
    }
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
    else if (src[i] === '|' && depth === 1) return true;
  }
  return false;
}

function paramName(src: string): string {
  const name = /^\{\s*([^{}|:\s]+)/.exec(src)?.[1];
  return name ? idSafe(name) : 'ph';
}

// XLIFF ids are NMTOKEN: keep letters, digits, dot, dash, underscore
function idSafe(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe || 'ph';
}

function renderParts(parts: Part[], taken: Map<string, number>): string {
  let out = '';
  for (const part of parts) {
    if (part.kind === 'text') {
      out += escapeXml(part.text);
    } else if (part.kind === 'ph') {
      out += `<ph id="${uniqueId(part.name, taken)}" disp="${escapeXml(part.src)}"/>`;
    } else {
      const id = uniqueId(part.name, taken);
      out += `<pc id="${id}" dispStart="${escapeXml(part.openSrc)}" dispEnd="${escapeXml(part.closeSrc)}">`;
      out += renderParts(part.children, taken);
      out += '</pc>';
    }
  }
  return out;
}

function uniqueId(name: string, taken: Map<string, number>): string {
  const count = taken.get(name) ?? 0;
  taken.set(name, count + 1);
  return count === 0 ? name : `${name}${count + 1}`;
}

function findPcClose(xml: string, from: number): { innerEnd: number; end: number } | undefined {
  const tags = /<pc\b[^>]*>|<\/pc\s*>/g;
  tags.lastIndex = from;
  let depth = 1;
  for (let match = tags.exec(xml); match; match = tags.exec(xml)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { innerEnd: match.index, end: tags.lastIndex };
  }
  return undefined;
}

function attr(attrs: string, name: string): string | undefined {
  const value = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1];
  return value === undefined ? undefined : unescapeXml(value);
}
