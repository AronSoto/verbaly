import { parse, type MessageNode } from 'verbaly';

export const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many']);
export type IssueSeverity = 'error' | 'warning';

export interface StructureIssue {
  severity: IssueSeverity;
  message: string;
}

interface VariantShape {
  selectors: string[];
  plural: boolean;
  ordinal: boolean;
}

const EXACT = /^=\d+$/;

// param name → its plural/select block, when it has one; first block per name wins
function shapes(message: string): Map<string, VariantShape> {
  const out = new Map<string, VariantShape>();
  walk(parse(message), out);
  return out;
}

function walk(nodes: MessageNode[], out: Map<string, VariantShape>): void {
  for (const node of nodes) {
    if (node.kind !== 'param' || !node.variants) continue;
    const selectors = node.variants.map(([key]) => key);
    if (!out.has(node.name)) {
      out.set(node.name, {
        selectors,
        plural: selectors.some((key) => PLURAL_CATEGORIES.has(key)),
        ordinal: node.ordinal === true,
      });
    }
    for (const [, body] of node.variants) walk(body, out);
  }
}

function paramNames(message: string): string[] {
  const names = new Set<string>();
  collect(parse(message), names);
  return [...names].sort();
}

function collect(nodes: MessageNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.kind !== 'param') continue;
    out.add(node.name);
    if (node.variants) for (const [, body] of node.variants) collect(body, out);
  }
}

const TAG = /<(\/?)([a-zA-Z][\w-]*)(\/?)>/g;

// markup is only what the message closes (</x>) or self-closes (<x/>): a lone <Enter> is prose
function markupNames(message: string): Set<string> {
  const out = new Set<string>();
  for (const match of message.matchAll(TAG)) {
    if (match[1] || match[3]) out.add(match[2]!);
  }
  return out;
}

function tagTokens(message: string, markup: Set<string>): string[] {
  const out: string[] = [];
  for (const match of message.matchAll(TAG)) {
    if (markup.has(match[2]!)) out.push(`${match[1]}${match[2]}${match[3]}`);
  }
  return out.sort();
}

// items in a that are missing from b, counting duplicates
function surplus(a: string[], b: string[]): string[] {
  const rest = [...b];
  const out: string[] = [];
  for (const item of a) {
    const at = rest.indexOf(item);
    if (at < 0) out.push(item);
    else rest.splice(at, 1);
  }
  return out;
}

function list(items: string[]): string {
  return items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : items[0]!;
}

// one message on its own: defects that need no source to be visible
export function validateMessage(message: string, locale?: string): StructureIssue[] {
  const issues: StructureIssue[] = [];
  for (const [name, shape] of shapes(message)) {
    if (!shape.plural) continue; // a select block without 'other' is the author's design
    if (!shape.selectors.includes('other')) {
      issues.push({
        severity: 'error',
        message: `the plural block for {${name}} has no "other" case, so any count it does not list renders empty`,
      });
      continue;
    }
    if (!locale) continue;
    const missing = reachableCategories(locale, shape.ordinal).filter(
      (category) => category !== 'other' && !shape.selectors.includes(category),
    );
    if (missing.length > 0) {
      issues.push({
        severity: 'warning',
        message: `${locale} also needs the ${list(missing)} plural ${missing.length > 1 ? 'forms' : 'form'} for {${name}}`,
      });
    }
  }
  return issues;
}

// a translation against the source it must mirror
export function validatePair(source: string, translated: string): StructureIssue[] {
  const issues: StructureIssue[] = [];

  const lostParams = surplus(paramNames(source), paramNames(translated));
  const newParams = surplus(paramNames(translated), paramNames(source));
  if (lostParams.length > 0) {
    issues.push({
      severity: 'error',
      message: `${list(lostParams.map((name) => `{${name}}`))} ${lostParams.length > 1 ? 'are' : 'is'} missing, so ${lostParams.length > 1 ? 'their values' : 'its value'} never reaches the text`,
    });
  }
  if (newParams.length > 0) {
    issues.push({
      severity: 'error',
      message: `${list(newParams.map((name) => `{${name}}`))} ${newParams.length > 1 ? 'are' : 'is'} not in the source message, so ${newParams.length > 1 ? 'they render' : 'it renders'} as literal text`,
    });
  }

  // one vocabulary for both sides: a tag the translation invents is still caught
  const markup = new Set([...markupNames(source), ...markupNames(translated)]);
  const lostTags = tagReport(surplus(tagTokens(source, markup), tagTokens(translated, markup)));
  const newTags = tagReport(surplus(tagTokens(translated, markup), tagTokens(source, markup)));
  if (lostTags.length > 0) {
    issues.push({
      severity: 'error',
      message: `${list(lostTags)} ${lostTags.length > 1 ? 'are' : 'is'} missing from the translation`,
    });
  }
  if (newTags.length > 0) {
    issues.push({
      severity: 'error',
      message: `${list(newTags)} ${newTags.length > 1 ? 'are' : 'is'} not in the source message`,
    });
  }

  const target = shapes(translated);
  for (const [name, shape] of shapes(source)) {
    const other = target.get(name);
    if (!other) {
      issues.push({
        severity: 'error',
        message: `the ${shape.plural ? 'plural' : 'select'} block for {${name}} was flattened into plain text`,
      });
      continue;
    }
    // 'other' is the catch-all: losing it renders empty (the plural case is validateMessage's)
    if (shape.selectors.includes('other') && !other.selectors.includes('other') && !other.plural) {
      issues.push({
        severity: 'error',
        message: `the "other" case for {${name}} is missing, so unlisted values render empty`,
      });
    }
    const lostExact = shape.selectors
      .filter((key) => EXACT.test(key))
      .filter((key) => !other.selectors.includes(key));
    if (lostExact.length > 0) {
      issues.push({
        severity: 'warning',
        message: `the ${list(lostExact)} ${lostExact.length > 1 ? 'cases' : 'case'} for {${name}} ${lostExact.length > 1 ? 'are' : 'is'} missing, so ${lostExact.length > 1 ? 'those counts' : 'that count'} falls back to "other"`,
      });
    }
  }

  return issues;
}

// one entry per tag name: a translator restores the pair, not a lone closing tag
function tagReport(tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const name = token.replaceAll('/', '');
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(token.endsWith('/') ? `<${name}/>` : `<${name}>`);
  }
  return out;
}

const COUNT_PROBE = 200; // the range a UI counter realistically reaches
const reachable = new Map<string, string[]>();

function reachableCategories(locale: string, ordinal: boolean): string[] {
  const type = ordinal ? 'ordinal' : 'cardinal';
  // the escape, never the raw character: a literal NUL makes git treat the file as binary
  const cacheKey = `${locale}\u0000${type}`;
  const hit = reachable.get(cacheKey);
  if (hit) return hit;

  let out: string[];
  try {
    const rules = new Intl.PluralRules(locale, { type });
    const seen = new Set<string>();
    for (let n = 0; n <= COUNT_PROBE; n++) seen.add(rules.select(n));
    out = [...seen];
  } catch {
    out = []; // unknown tag: nothing is ever reported missing
  }
  reachable.set(cacheKey, out);
  return out;
}
