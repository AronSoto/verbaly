import {
  analyze,
  analyzeScript,
  parseErrorMessage,
  type Analysis,
  type AnalyzeOptions,
  type MissedCall,
  type StrayImport,
  type TaggedParam,
  type UsedKey,
} from './analyze';

export const SFC_FILE_RE = /\.(?:svelte|vue|astro)$/;

// single dispatch point: SFCs get the block/markup analyzer, everything else plain analyze
export function analyzeFile(code: string, file: string): Analysis {
  if (SFC_FILE_RE.test(file)) return analyzeSfc(code, file);
  try {
    return analyze(code, file);
  } catch (error) {
    // one file the parser cannot read must never take down a whole extract, check or doctor
    const message = parseErrorMessage(error);
    return { tagged: [], usedKeys: [], strayImports: [], missed: [], parseError: message };
  }
}

const SCRIPT_RE = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
// astro component script: --- fences at the top of the file
const FRONTMATTER_RE = /^(\uFEFF?\s*---\r?\n)([\s\S]*?)\r?\n---(?=\r?\n|$)/;

const MUSTACHE_RE = /\{\{[\s\S]*?\}\}/g;
const DIRECTIVE_RE = /\s(?:v-[\w-]+(?::[^\s=>/]+)?|[:@][^\s=>/]+)\s*=\s*("[^"]*"|'[^']*')/g;

export function analyzeSfc(code: string, file: string): Analysis {
  // svelte components consume t as a store: $t`…` is the idiomatic form
  const svelte = file.endsWith('.svelte');
  const tNames = svelte ? ['t', '$t'] : ['t'];

  const tagged: Analysis['tagged'] = [];
  const usedKeys: UsedKey[] = [];
  const strayImports: StrayImport[] = [];
  const missed: MissedCall[] = [];
  const renamed = new Set<string>();
  const lineAt = lineCounter(code);
  let parseError: string | undefined;

  // a script block is structural: if it does not parse, the file is reported, unlike a markup slice
  const block = (content: string, offset: number): void => {
    const segment = analyzeSegment(content, file, { tNames });
    parseError ??= segment.error;
    for (const name of segment.renamed) renamed.add(name);
    merge(segment.analysis, offset, false);
  };

  const frontmatter = file.endsWith('.astro') ? FRONTMATTER_RE.exec(code) : null;
  if (frontmatter?.[2]) block(frontmatter[2], frontmatter[1]!.length);

  for (const match of code.matchAll(SCRIPT_RE)) {
    const content = match[2]!;
    if (content) block(content, match.index + match[1]!.length);
  }

  // markup = everything left once frontmatter, scripts, styles and comments are blanked out
  const body = frontmatter
    ? ' '.repeat(frontmatter[0].length) + code.slice(frontmatter[0].length)
    : code;
  const markup = blank(blank(blank(body, SCRIPT_RE), STYLE_RE), COMMENT_RE);
  // the markup reads the script's bindings, so a t renamed there is followed here too
  const markupOptions: AnalyzeOptions = { tNames, renamed: [...renamed] };
  // display-only text never yields candidates: only expression context counts
  const ranges = file.endsWith('.vue') ? vueExpressionRanges(markup) : braceRanges(markup);
  let range = 0;
  let consumedTo = 0;
  for (const match of markup.matchAll(candidatePattern(svelte, renamed))) {
    const start = match.index;
    if (start < consumedTo) continue;
    while (range < ranges.length && ranges[range]![1] <= start) range += 1;
    if (range >= ranges.length || start < ranges[range]![0]) continue;
    const end = expressionExtent(markup, start, match[0].length);
    if (end === undefined) continue;
    merge(analyzeSegment(code.slice(start, end), file, markupOptions).analysis, start, true);
    consumedTo = end;
  }

  return { tagged, usedKeys, strayImports, missed, ...(parseError && { parseError }) };

  function merge(analysis: Analysis | undefined, offset: number, markupSegment: boolean): void {
    if (!analysis) return;
    const lines = lineAt(offset) - 1;
    for (const msg of analysis.tagged) {
      tagged.push({
        ...msg,
        start: msg.start + offset,
        end: msg.end + offset,
        line: msg.line + lines,
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
    for (const call of analysis.missed) {
      missed.push({ ...call, start: call.start + offset, line: call.line + lines });
    }
    usedKeys.push(...analysis.usedKeys);
    strayImports.push(...analysis.strayImports);
  }
}

// no whitespace after the name: prose like "won't ('x')" must never become a used key
function candidatePattern(svelte: boolean, renamed: ReadonlySet<string>): RegExp {
  const bare = new Set(['t', ...[...renamed].map((name) => name.replace(/^\$/, ''))]);
  const names = [...bare].map((name) => name.replace(/[$]/g, '\\$')).join('|');
  return new RegExp(`(?<![\\w$])${svelte ? '\\$?' : ''}(?:${names})(?=[\`(]|\\.id\\()`, 'g');
}

// 1-based line of an offset, from one pass over the file however many segments ask
function lineCounter(code: string): (offset: number) => number {
  const breaks: number[] = [];
  for (let i = code.indexOf('\n'); i !== -1; i = code.indexOf('\n', i + 1)) breaks.push(i);
  return (offset) => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (breaks[mid]! < offset) low = mid + 1;
      else high = mid;
    }
    return low + 1;
  };
}

interface SegmentResult {
  analysis?: Analysis;
  renamed: string[];
  error?: string;
}

function analyzeSegment(code: string, file: string, options: AnalyzeOptions): SegmentResult {
  try {
    return analyzeScript(code, file, options);
  } catch (error) {
    // never fail the whole file over one segment
    return { renamed: [], error: parseErrorMessage(error) };
  }
}

function blank(source: string, re: RegExp): string {
  return source.replace(re, (m) => ' '.repeat(m.length));
}

// [start, end) content spans of balanced {…} regions (astro expressions, svelte mustaches)
function braceRanges(markup: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < markup.length) {
    if (markup[i] === '{') {
      const end = balancedEnd(markup, i);
      if (end !== undefined) {
        ranges.push([i + 1, end - 1]);
        i = end;
        continue;
      }
    }
    i += 1;
  }
  return ranges;
}

// vue expression context: {{ mustaches }} plus quoted values of :/@/v- directive attributes
function vueExpressionRanges(markup: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of markup.matchAll(MUSTACHE_RE)) {
    ranges.push([match.index + 2, match.index + match[0].length - 2]);
  }
  for (const match of markup.matchAll(DIRECTIVE_RE)) {
    const valueStart = match.index + match[0].length - match[1]!.length + 1;
    ranges.push([valueStart, valueStart + match[1]!.length - 2]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

// end (exclusive) of the expression starting at a candidate: t`…` | t(...) | t.id('…')`…`
function expressionExtent(code: string, start: number, nameLength: number): number | undefined {
  const i = start + nameLength;
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
