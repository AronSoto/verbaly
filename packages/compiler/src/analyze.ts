import { parse } from '@babel/parser';
import { stableKey } from './key';

export interface TaggedParam {
  name: string;
  start: number;
  end: number;
}

export interface TransComponent {
  name: string;
  source: string;
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
  jsx?: { name: string; components: TransComponent[] };
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
      const explicit = explicitId(tag);
      if (!explicit && !isTReference(tag)) return;
      const quasi = node.quasi as AstNode;
      const message = buildMessage(code, quasi);
      if (!message) return;
      tagged.push({
        key: explicit ? explicit.key : stableKey(message.text),
        message: message.text,
        params: message.params,
        start: node.start,
        end: node.end,
        tagStart: explicit ? explicit.refStart : tag.start,
        tagEnd: explicit ? explicit.refEnd : tag.end,
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
    } else if (node.type === 'JSXElement') {
      handleTrans(code, node, file, tagged, usedKeys);
    }
  });

  return { tagged, usedKeys };
}

function handleTrans(
  code: string,
  node: AstNode,
  file: string,
  tagged: TaggedMessage[],
  usedKeys: UsedKey[],
): void {
  const opening = node.openingElement as AstNode;
  const nameNode = opening.name as AstNode;
  if (nameNode.type !== 'JSXIdentifier' || nameNode.name !== 'Trans') return;

  const attrs = opening.attributes as AstNode[];
  const idAttr = attrs.find((a) => a.type === 'JSXAttribute' && (a.name as AstNode).name === 'id');
  const children = node.children as AstNode[] | undefined;

  if (idAttr) {
    const value = idAttr.value as AstNode | null;
    if (value?.type !== 'StringLiteral') return;
    const id = value.value as string;
    // id + children → extract under the explicit key
    if (attrs.length === 1 && children?.length) {
      const built = buildTransMessage(code, children);
      if (built?.text.trim()) {
        tagged.push({
          key: id,
          message: built.text,
          params: built.params,
          start: node.start,
          end: node.end,
          tagStart: nameNode.start,
          tagEnd: nameNode.end,
          file,
          jsx: { name: nameNode.name as string, components: built.components },
        });
        return;
      }
    }
    usedKeys.push({ key: id, file });
    return; // runtime-first, untouched
  }
  if (attrs.length > 0) return; // hand-written props → don't guess

  if (!children?.length) return;

  const built = buildTransMessage(code, children);
  if (!built || !built.text.trim()) return;

  tagged.push({
    key: stableKey(built.text),
    message: built.text,
    params: built.params,
    start: node.start,
    end: node.end,
    tagStart: nameNode.start,
    tagEnd: nameNode.end,
    file,
    jsx: { name: nameNode.name as string, components: built.components },
  });
}

// t.id('key')`…` → explicit readable key
function explicitId(tag: AstNode): { key: string; refStart: number; refEnd: number } | undefined {
  if (tag.type !== 'CallExpression') return undefined;
  const callee = tag.callee as AstNode;
  if (callee.type !== 'MemberExpression' || callee.computed) return undefined;
  const prop = callee.property as AstNode;
  if (prop.type !== 'Identifier' || prop.name !== 'id') return undefined;
  const obj = callee.object as AstNode;
  if (!isTReference(obj)) return undefined;
  const args = tag.arguments as AstNode[];
  const first = args[0];
  if (args.length !== 1 || first?.type !== 'StringLiteral') return undefined;
  return { key: first.value as string, refStart: obj.start, refEnd: obj.end };
}

interface BuiltTrans {
  text: string;
  params: TaggedParam[];
  components: TransComponent[];
}

function buildTransMessage(code: string, children: AstNode[]): BuiltTrans | undefined {
  const params: TaggedParam[] = [];
  const components: TransComponent[] = [];
  const takenParams = new Map<string, string>();
  const takenTags = new Map<string, string>();

  function walkChildren(nodes: AstNode[]): string | undefined {
    let text = '';
    for (const child of nodes) {
      if (child.type === 'JSXText') {
        text += escapeText(cleanJsxText(child.value as string));
      } else if (child.type === 'JSXExpressionContainer') {
        const expr = child.expression as AstNode;
        if (expr.type === 'JSXEmptyExpression') continue;
        if (expr.type === 'StringLiteral') {
          text += escapeText(expr.value as string);
          continue;
        }
        if (containsTaggedT(expr)) return undefined; // overlap hazard
        const source = code.slice(expr.start, expr.end);
        const name = uniqueName(deriveName(expr, params.length), source, takenParams);
        params.push({ name, start: expr.start, end: expr.end });
        text += `{${name}}`;
      } else if (child.type === 'JSXElement') {
        const opening = child.openingElement as AstNode;
        const nameNode = opening.name as AstNode;
        if (nameNode.type !== 'JSXIdentifier' || nameNode.name === 'Trans') return undefined;
        const source = selfClosedSource(code, opening);
        const tag = uniqueName((nameNode.name as string).toLowerCase(), source, takenTags);
        if (!components.some((c) => c.name === tag)) components.push({ name: tag, source });
        if (!child.closingElement) {
          text += `<${tag}/>`;
        } else {
          const inner = walkChildren(child.children as AstNode[]);
          if (inner === undefined) return undefined;
          text += `<${tag}>${inner}</${tag}>`;
        }
      } else {
        return undefined; // fragments / spread children → bail
      }
    }
    return text;
  }

  const text = walkChildren(children);
  if (text === undefined) return undefined;
  return { text, params, components };
}

// JSX text semantics: newline-indent boundaries removed, interior joins = one space
function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|[\r\n]/);
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]!.replace(/\t/g, ' ');
    if (i !== 0) line = line.replace(/^ +/, '');
    if (i !== lines.length - 1) line = line.replace(/ +$/, '');
    if (!line) continue;
    if (out && i !== 0) out += ' ';
    out += line;
  }
  return out;
}

function selfClosedSource(code: string, opening: AstNode): string {
  const src = code.slice(opening.start, opening.end);
  return src.endsWith('/>') ? src : `${src.slice(0, -1).trimEnd()} />`;
}

// true if the subtree holds a t`…` / t.id('…')`…` that analyze would extract itself
function containsTaggedT(node: AstNode): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type !== 'TaggedTemplateExpression') return;
    const tag = n.tag as AstNode;
    if (isTReference(tag) || explicitId(tag)) found = true;
  });
  return found;
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
    // a nested t`…` would be extracted on its own — overlapping rewrites; bail the outer
    if (containsTaggedT(expr)) return undefined;
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
