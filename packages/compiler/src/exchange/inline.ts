// XLIFF 2.0 inline codes: {params} as <ph>, paired tags as <pc>, disp carries the source slice
import { isIcu } from '../catalog/catalog';
import { decodeEntities, readAttributes, TAG_REST, type Attribute } from '../util/markup';

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'ph'; name: string; src: string }
  | { kind: 'pc'; name: string; openSrc: string; closeSrc: string; children: Part[] };

const OPEN_TAG = /^<([a-zA-Z][a-zA-Z0-9-]*)\s*(\/?)>/;
const PH_EMPTY = new RegExp(`^<ph\\b(${TAG_REST}?)/\\s*>`);
const PH_PAIRED = new RegExp(`^<ph\\b(${TAG_REST})>\\s*</ph\\s*>`);
const PC_OPEN = new RegExp(`^<pc\\b(${TAG_REST})>`);
const PC_TAGS = `<pc\\b${TAG_REST}>|</pc\\s*>`;
// the breaks core's parseTags reads whole however they are written: keep the two lists equal
const BREAK = /^(?:br|wbr)$/;

// how a message spells its braces: verbaly doubles one to escape it, ICU quotes it with apostrophes
interface Syntax {
  // the length of the escape that starts here, 0 when there is none
  escape(text: string, at: number): number;
  // a block whose bodies are text a translator edits, so it travels as text
  translatable(src: string): boolean;
}

const VERBALY: Syntax = {
  escape: (text, at) => (text.startsWith('{{', at) || text.startsWith('}}', at) ? 2 : 0),
  translatable: hasTopLevelPipe,
};

const ICU_BLOCK = /^\{\s*[a-zA-Z0-9_]+\s*,\s*(?:plural|selectordinal|select)\b/;

const ICU: Syntax = {
  escape(text, at) {
    if (text[at] !== "'") return 0;
    if (text[at + 1] === "'") return 2;
    if (!'{}#|'.includes(text[at + 1] ?? ' ')) return 0;
    // a quoted run ends at the next apostrophe that is not doubled
    for (let end = at + 1; end < text.length; end++) {
      if (text[end] !== "'") continue;
      if (text[end + 1] === "'") end += 1;
      else return end - at + 1;
    }
    return text.length - at;
  },
  translatable: (src) => ICU_BLOCK.test(src),
};

export function messageToInline(text: string): string {
  // an ICU message closes a block with }}, which verbaly's own syntax reads as an escaped brace
  const parsed = parseParts(text, 0, isIcu(text) ? ICU : VERBALY);
  return renderParts(parsed.parts, new Map());
}

export function inlineToMessage(xml: string): string {
  let out = '';
  let text = '';
  let i = 0;
  const flush = () => {
    out += decodeEntities(text);
    text = '';
  };
  while (i < xml.length) {
    if (xml[i] === '<') {
      const slice = xml.slice(i);
      const ph = PH_EMPTY.exec(slice) ?? PH_PAIRED.exec(slice);
      if (ph) {
        flush();
        const attrs = readAttributes(ph[1]!);
        out += attr(attrs, 'disp') ?? `{${attr(attrs, 'id') ?? 'ph'}}`;
        i += ph[0].length;
        continue;
      }
      const pc = PC_OPEN.exec(slice);
      if (pc) {
        const close = findPcClose(xml, i + pc[0].length);
        if (close) {
          flush();
          const attrs = readAttributes(pc[1]!);
          const id = attr(attrs, 'id') ?? 'pc';
          out += attr(attrs, 'dispStart') ?? `<${id}>`;
          out += inlineToMessage(xml.slice(i + pc[0].length, close.innerEnd));
          out += attr(attrs, 'dispEnd') ?? `</${id}>`;
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

interface ParsedParts {
  parts: Part[];
  end: number;
  closed: boolean;
}

function parseParts(text: string, pos: number, syntax: Syntax, closeTag?: string): ParsedParts {
  const parts: Part[] = [];
  let plain = '';
  const flush = () => {
    if (plain) parts.push({ kind: 'text', text: plain });
    plain = '';
  };
  let i = pos;
  while (i < text.length) {
    const escaped = syntax.escape(text, i);
    if (escaped > 0) {
      plain += text.slice(i, i + escaped);
      i += escaped;
      continue;
    }
    if (text[i] === '{') {
      const end = matchBrace(text, i, syntax);
      if (end === -1) {
        plain += '{';
        i += 1;
        continue;
      }
      const src = text.slice(i, end + 1);
      if (syntax.translatable(src)) {
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
        // a break is whole on its own, as the runtime reads it: <br> is protected like <br/>
        if (selfClose || BREAK.test(name)) {
          flush();
          parts.push({ kind: 'ph', name: idSafe(name), src: openSrc });
          i += openSrc.length;
          continue;
        }
        const inner = parseParts(text, i + openSrc.length, syntax, name);
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

function matchBrace(text: string, start: number, syntax: Syntax): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const escaped = syntax.escape(text, i);
    if (escaped > 0) {
      i += escaped - 1;
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
  const name = /^\{\s*([^{}|:,\s]+)/.exec(src)?.[1];
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
  const tags = new RegExp(PC_TAGS, 'g');
  tags.lastIndex = from;
  let depth = 1;
  for (let match = tags.exec(xml); match; match = tags.exec(xml)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return { innerEnd: match.index, end: tags.lastIndex };
  }
  return undefined;
}

function attr(attrs: Map<string, Attribute>, name: string): string | undefined {
  const value = attrs.get(name)?.value;
  return value === undefined ? undefined : decodeEntities(value);
}
