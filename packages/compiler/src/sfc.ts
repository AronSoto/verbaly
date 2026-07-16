import { analyze, type Analysis, type TaggedParam, type UsedKey } from './analyze';

export const SFC_FILE_RE = /\.(?:svelte|vue)$/;

// single dispatch point: SFCs get the block/markup analyzer, everything else plain analyze
export function analyzeFile(code: string, file: string): Analysis {
  return SFC_FILE_RE.test(file) ? analyzeSfc(code, file) : analyze(code, file);
}

const SCRIPT_RE = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

// no whitespace after t: prose like "won't ('x')" must never become a used key
const CANDIDATE_SVELTE = /(?<![\w$])\$?t(?=[`(]|\.id\()/g;
const CANDIDATE_VUE = /(?<![\w$])t(?=[`(]|\.id\()/g;

export function analyzeSfc(code: string, file: string): Analysis {
  // svelte components consume t as a store: $t`…` is the idiomatic form
  const svelte = file.endsWith('.svelte');
  const options = svelte ? { tNames: ['t', '$t'] } : undefined;

  const tagged: Analysis['tagged'] = [];
  const usedKeys: UsedKey[] = [];

  for (const match of code.matchAll(SCRIPT_RE)) {
    const content = match[2]!;
    if (!content) continue;
    merge(analyzeSegment(content, file, options), match.index + match[1]!.length, false);
  }

  // markup = everything left once scripts, styles and comments are blanked out
  const markup = blank(blank(blank(code, SCRIPT_RE), STYLE_RE), COMMENT_RE);
  const candidates = svelte ? CANDIDATE_SVELTE : CANDIDATE_VUE;
  let consumedTo = 0;
  for (const match of markup.matchAll(candidates)) {
    const start = match.index;
    if (start < consumedTo) continue;
    const end = expressionExtent(markup, start);
    if (end === undefined) continue;
    merge(analyzeSegment(code.slice(start, end), file, options), start, true);
    consumedTo = end;
  }

  return { tagged, usedKeys };

  function merge(analysis: Analysis | undefined, offset: number, markupSegment: boolean): void {
    if (!analysis) return;
    for (const msg of analysis.tagged) {
      tagged.push({
        ...msg,
        start: msg.start + offset,
        end: msg.end + offset,
        tagStart: msg.tagStart + offset,
        tagEnd: msg.tagEnd + offset,
        params: msg.params.map((p): TaggedParam => ({
          ...p,
          start: p.start + offset,
          end: p.end + offset,
        })),
        ...(markupSegment && { singleQuote: true }),
      });
    }
    usedKeys.push(...analysis.usedKeys);
  }
}

function analyzeSegment(
  code: string,
  file: string,
  options?: { tNames: string[] },
): Analysis | undefined {
  try {
    return analyze(code, file, options);
  } catch {
    return undefined; // malformed segment: skip it, never fail the whole file
  }
}

function blank(source: string, re: RegExp): string {
  return source.replace(re, (m) => ' '.repeat(m.length));
}

// end (exclusive) of the expression starting at a candidate: t`…` | t(...) | t.id('…')`…`
function expressionExtent(code: string, start: number): number | undefined {
  let i = start;
  if (code[i] === '$') i += 1;
  i += 1; // the t itself
  if (code.startsWith('.id(', i)) {
    const close = balancedEnd(code, i + 3);
    if (close === undefined || code[close] !== '`') return undefined;
    return balancedEnd(code, close);
  }
  if (code[i] === '`' || code[i] === '(') return balancedEnd(code, i);
  return undefined;
}

// scans a template literal or paren group to its close, tracking nested ${…}, strings and groups
function balancedEnd(code: string, open: number): number | undefined {
  const stack: string[] = [];
  let i = open;
  while (i < code.length) {
    const ch = code[i]!;
    if (stack[stack.length - 1] === '`') {
      if (ch === '\\') i += 1;
      else if (ch === '`') stack.pop();
      else if (ch === '$' && code[i + 1] === '{') {
        stack.push('{');
        i += 1;
      }
    } else if (ch === "'" || ch === '"') {
      i = stringEnd(code, i);
    } else if (ch === '`' || ch === '(' || ch === '{') {
      stack.push(ch);
    } else if (ch === ')' || ch === '}') {
      if (stack[stack.length - 1] !== (ch === ')' ? '(' : '{')) return undefined;
      stack.pop();
    }
    i += 1;
    if (stack.length === 0) return i;
  }
  return undefined;
}

function stringEnd(code: string, start: number): number {
  const quote = code[start];
  let i = start + 1;
  while (i < code.length) {
    if (code[i] === '\\') i += 2;
    else if (code[i] === quote) return i;
    else i += 1;
  }
  return code.length;
}
