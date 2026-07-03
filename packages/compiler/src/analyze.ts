import { parse } from '@babel/parser';
import { stableKey } from './key';

export interface TaggedParam {
  name: string;
  start: number;
  end: number;
}

export interface TaggedMessage {
  key: string;
  message: string;
  params: TaggedParam[];
  start: number;
  end: number;
  tagStart: number;
  tagEnd: number;
  file: string;
}

export interface UsedKey {
  key: string;
  file: string;
}

export interface Analysis {
  tagged: TaggedMessage[];
  usedKeys: UsedKey[];
}

interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const SKIP_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

export function analyze(code: string, file: string): Analysis {
  const jsx = /\.[jt]sx$/.test(file);
  const ast = parse(code, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: jsx ? ['typescript', 'jsx'] : ['typescript'],
  });

  const tagged: TaggedMessage[] = [];
  const usedKeys: UsedKey[] = [];

  walk(ast.program as unknown as AstNode, (node) => {
    if (node.type === 'TaggedTemplateExpression') {
      const tag = node.tag as AstNode;
      if (!isTReference(tag)) return;
      const quasi = node.quasi as AstNode;
      const message = buildMessage(code, quasi);
      if (!message) return;
      tagged.push({
        key: stableKey(message.text),
        message: message.text,
        params: message.params,
        start: node.start,
        end: node.end,
        tagStart: tag.start,
        tagEnd: tag.end,
        file,
      });
    } else if (node.type === 'CallExpression') {
      const callee = node.callee as AstNode;
      if (!isTReference(callee)) return;
      const args = node.arguments as AstNode[];
      const first = args[0];
      if (first?.type === 'StringLiteral') {
        usedKeys.push({ key: first.value as string, file });
      }
    }
  });

  return { tagged, usedKeys };
}

function isTReference(node: AstNode): boolean {
  if (node.type === 'Identifier') return node.name === 't';
  if (node.type === 'MemberExpression' && !node.computed) {
    const prop = node.property as AstNode;
    return prop.type === 'Identifier' && prop.name === 't';
  }
  return false;
}

interface BuiltMessage {
  text: string;
  params: TaggedParam[];
}

function buildMessage(code: string, quasi: AstNode): BuiltMessage | undefined {
  const quasis = quasi.quasis as AstNode[];
  const expressions = quasi.expressions as AstNode[];
  const params: TaggedParam[] = [];
  const taken = new Map<string, string>();

  let text = escapeText(cookedValue(quasis[0]));

  for (let i = 0; i < expressions.length; i++) {
    const expr = expressions[i];
    if (!expr) return undefined;
    const source = code.slice(expr.start, expr.end);
    const name = uniqueName(deriveName(expr, i), source, taken);
    params.push({ name, start: expr.start, end: expr.end });
    text += `{${name}}` + escapeText(cookedValue(quasis[i + 1]));
  }
  return { text, params };
}

function cookedValue(element: AstNode | undefined): string {
  if (!element) return '';
  const value = element.value as { cooked?: string; raw: string };
  return value.cooked ?? value.raw;
}

// literal braces → escaped
function escapeText(text: string): string {
  return text.replace(/[{}]/g, (m) => m + m);
}

function deriveName(expr: AstNode, index: number): string {
  if (expr.type === 'Identifier') return expr.name as string;
  if (expr.type === 'MemberExpression' && !expr.computed) {
    const prop = expr.property as AstNode;
    if (prop.type === 'Identifier') return prop.name as string;
  }
  return `_${index}`;
}

function uniqueName(base: string, source: string, taken: Map<string, string>): string {
  let name = base;
  let n = 2;
  while (taken.has(name) && taken.get(name) !== source) {
    name = `${base}${n}`;
    n += 1;
  }
  taken.set(name, source);
  return name;
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) walk(item, visit);
      }
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

function isNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
