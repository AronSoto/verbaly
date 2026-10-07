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
  line: number;
  tagStart: number;
  tagEnd: number;
  file: string;
  jsx?: { name: string; components: TransComponent[] };
  singleQuote?: boolean;
}

export interface UsedKey {
  key: string;
  file: string;
  loose?: true;
}

// a named import the verbaly packages do not export: t comes from an instance, never from a package
export interface StrayImport {
  name: string;
  source: string;
  file: string;
}

// a tagged template on t under another name: never extracted, never rewritten, never translated
export interface MissedCall {
  name: string;
  file: string;
  start: number;
  line: number;
}

export interface Analysis {
  tagged: TaggedMessage[];
  usedKeys: UsedKey[];
  strayImports: StrayImport[];
  missed: MissedCall[];
  parseError?: string;
}

// babel's message carries the position but never the path: every caller adds the file itself
export function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// exported for wrap.ts (module-internal reuse, not part of the package surface)
export interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

const SKIP_KEYS = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

export interface AnalyzeOptions {
  tNames?: readonly string[];
  renamed?: readonly string[];
}

const DEFAULT_T_NAMES: readonly string[] = ['t'];
const JSX_FILE_RE = /\.(?:[cm]?jsx?|tsx)$/;

// a key module declares what a call site would otherwise pass as a literal the scanner can read
const DEFINE_KEYS = 'defineKeys';

export function analyze(code: string, file: string, options: AnalyzeOptions = {}): Analysis {
  return analyzeScript(code, file, options).analysis;
}

// a tagged template or a call on a name other than t, judged once every binding is known
type Candidate = { kind: 'tag'; node: AstNode } | { kind: 'call'; name: string; key: string };

// the analysis plus the names t was renamed to, which an SFC hands on to its markup
export function analyzeScript(
  code: string,
  file: string,
  options: AnalyzeOptions = {},
): { analysis: Analysis; renamed: string[] } {
  const names = new Set(options.tNames ?? DEFAULT_T_NAMES);
  const ast = parse(code, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: JSX_FILE_RE.test(file) ? ['typescript', 'jsx'] : ['typescript'],
  });

  const tagged: TaggedMessage[] = [];
  const usedKeys: UsedKey[] = [];
  const strayImports: StrayImport[] = [];
  const bindings = new Bindings(names);
  const candidates: Candidate[] = [];

  walk(ast.program as unknown as AstNode, (node) => {
    if (node.type === 'ImportDeclaration') {
      collectStrayImports(node, file, strayImports);
      bindings.addImport(node);
    } else if (node.type === 'VariableDeclarator') {
      bindings.addDeclarator(node);
    } else if (node.type === 'TaggedTemplateExpression') {
      const tag = node.tag as AstNode;
      const explicit = explicitId(tag, names);
      if (!explicit && !isTReference(tag, names)) {
        candidates.push({ kind: 'tag', node });
        return;
      }
      const quasi = node.quasi as AstNode;
      const message = buildMessage(code, quasi, names);
      if (!message) return;
      tagged.push({
        key: explicit ? explicit.key : stableKey(message.text),
        message: message.text,
        params: message.params,
        start: node.start,
        end: node.end,
        line: lineOf(node),
        tagStart: explicit ? explicit.refStart : tag.start,
        tagEnd: explicit ? explicit.refEnd : tag.end,
        file,
      });
    } else if (node.type === 'CallExpression') {
      const callee = node.callee as AstNode;
      const args = node.arguments as AstNode[];
      if (callee.type === 'Identifier' && callee.name === DEFINE_KEYS) {
        collectDeclaredKeys(args[0], file, usedKeys);
        return;
      }
      if (!isTReference(callee, names)) {
        const key = callee.type === 'Identifier' ? staticString(args[0]) : undefined;
        if (key !== undefined) candidates.push({ kind: 'call', name: callee.name as string, key });
        return;
      }
      const key = staticString(args[0]);
      if (key !== undefined) usedKeys.push(usedKey(key, file, args[0]));
    } else if (node.type === 'JSXElement') {
      handleTrans(code, node, file, tagged, usedKeys, names);
    }
  });

  const renamed = bindings.renamed(options.renamed);
  const missed: MissedCall[] = [];
  for (const candidate of candidates) {
    // a key read under another name is in use: loose, so prune keeps it and no gate fails
    if (candidate.kind === 'call') {
      if (renamed.has(candidate.name)) usedKeys.push({ key: candidate.key, file, loose: true });
      continue;
    }
    const { node } = candidate;
    const name = renamedTag(node.tag as AstNode, renamed);
    if (!name) continue;
    missed.push({ name, file, start: node.start, line: lineOf(node) });
    // never extracted, yet its translation has to outlive prune until the binding is named t
    const key = missedKey(code, node, names);
    if (key !== undefined) usedKeys.push({ key, file, loose: true });
  }

  return { analysis: { tagged, usedKeys, strayImports, missed }, renamed: [...renamed] };
}

function lineOf(node: AstNode): number {
  return (node.loc as { start: { line: number } } | undefined)?.start.line ?? 1;
}

// a module whose exports hand out verbaly's t: the core, every adapter and virtual:verbaly
const VERBALY_SOURCE = /^(?:verbaly|virtual:verbaly|@verbaly\/[\w-]+(?:\/[\w-]+)*)$/;

// how each factory hands out t: useT() returns it, getT() resolves to it
const T_FACTORIES = new Map([
  ['useT', 'call'],
  ['getT', 'await'],
]);

// instance factories whose result carries t, for const { t: x } = useVerbaly() with no import
const INSTANCE_FACTORIES = new Set(['useVerbaly', 'getVerbaly']);

// what hands out a t in this file, judged by where each name was imported from
class Bindings {
  private imports = new Map<string, { source: string; imported: string }>();
  private direct = new Set<string>();
  private declared: { name: string; init: AstNode }[] = [];
  private destructured: { name: string; init: AstNode }[] = [];

  constructor(private names: ReadonlySet<string>) {}

  addImport(node: AstNode): void {
    const source = (node.source as { value?: unknown }).value;
    if (typeof source !== 'string') return;
    for (const spec of node.specifiers as AstNode[]) {
      const local = identifierName(spec.local as AstNode);
      if (!local) continue;
      const imported =
        spec.type === 'ImportSpecifier' ? importedName(spec.imported as AstNode) : spec.type;
      this.imports.set(local, { source, imported });
      if (source === 'virtual:verbaly' && imported === 't') this.direct.add(local);
    }
  }

  addDeclarator(node: AstNode): void {
    const id = node.id as AstNode;
    const init = node.init as AstNode | null;
    if (!init) return;
    if (id.type === 'Identifier') {
      this.declared.push({ name: id.name as string, init });
      return;
    }
    if (id.type !== 'ObjectPattern') return;
    for (const property of id.properties as AstNode[]) {
      if (property.type !== 'ObjectProperty' || property.computed) continue;
      if (identifierName(property.key as AstNode) !== 't') continue;
      const value = property.value as AstNode;
      // { t: x = fallback } binds x all the same
      const target = value.type === 'AssignmentPattern' ? (value.left as AstNode) : value;
      const name = identifierName(target);
      if (name) this.destructured.push({ name, init });
    }
  }

  renamed(seed: readonly string[] = []): Set<string> {
    const out = new Set(seed);
    const add = (name: string): void => {
      if (this.names.has(name)) return;
      out.add(name);
      // a svelte store is read as $name, the way t itself is read as $t
      if (this.names.has('$t')) out.add(`$${name}`);
    };
    for (const name of this.direct) add(name);
    for (const { name, init } of this.declared) if (this.handsOutT(init)) add(name);
    for (const { name, init } of this.destructured) if (this.carriesT(init)) add(name);
    return out;
  }

  // useT() or await getT(), imported from verbaly or not imported at all (a Nuxt auto-import)
  private handsOutT(init: AstNode): boolean {
    const awaited = init.type === 'AwaitExpression';
    const call = awaited ? (init.argument as AstNode) : init;
    if (call.type !== 'CallExpression') return false;
    const origin = this.origin(identifierName(call.callee as AstNode));
    if (origin.verbaly === false) return false;
    const how = T_FACTORIES.get(origin.imported);
    return how !== undefined && (how === 'await') === awaited;
  }

  // { t: x } reads from something verbaly handed out, or from an auto-imported instance factory
  private carriesT(init: AstNode): boolean {
    const inner = init.type === 'AwaitExpression' ? (init.argument as AstNode) : init;
    const read = inner.type === 'CallExpression' ? (inner.callee as AstNode) : inner;
    const name = identifierName(read);
    if (!name) return false;
    const origin = this.origin(name);
    return origin.verbaly ?? INSTANCE_FACTORIES.has(name);
  }

  private origin(local: string): { verbaly: boolean | undefined; imported: string } {
    const found = this.imports.get(local);
    if (!found) return { verbaly: undefined, imported: local };
    return { verbaly: VERBALY_SOURCE.test(found.source), imported: found.imported };
  }
}

function importedName(node: AstNode): string {
  return node.type === 'StringLiteral' ? (node.value as string) : identifierName(node);
}

function identifierName(node: AstNode | null | undefined): string {
  return node?.type === 'Identifier' ? (node.name as string) : '';
}

// x`…` or x.id('…')`…` where x is a renamed t
function renamedTag(tag: AstNode, renamed: ReadonlySet<string>): string | undefined {
  if (renamed.size === 0) return undefined;
  const name = identifierName(tag);
  if (renamed.has(name)) return name;
  if (tag.type !== 'CallExpression') return undefined;
  const callee = tag.callee as AstNode;
  if (callee.type !== 'MemberExpression' || callee.computed) return undefined;
  if (identifierName(callee.property as AstNode) !== 'id') return undefined;
  const object = identifierName(callee.object as AstNode);
  return renamed.has(object) ? object : undefined;
}

// the key a tagged template on a renamed t would have had: its quoted id, or its text's hash
function missedKey(code: string, node: AstNode, names: ReadonlySet<string>): string | undefined {
  const tag = node.tag as AstNode;
  if (tag.type === 'CallExpression') {
    const args = tag.arguments as AstNode[];
    const first = args[0];
    return args.length === 1 && first?.type === 'StringLiteral'
      ? (first.value as string)
      : undefined;
  }
  const message = buildMessage(code, node.quasi as AstNode, names);
  return message ? stableKey(message.text) : undefined;
}

// every string leaf is a key: the call is the author saying so, and '' still means untranslated
function collectDeclaredKeys(node: AstNode | undefined, file: string, out: UsedKey[]): void {
  if (node?.type !== 'ObjectExpression') return;
  for (const property of node.properties as AstNode[]) {
    if (property.type !== 'ObjectProperty') continue;
    const value = property.value as AstNode;
    const key = staticString(value);
    if (key !== undefined) {
      if (key !== '') out.push(usedKey(key, file, value));
    } else if (value.type === 'ObjectExpression') {
      collectDeclaredKeys(value, file, out);
    }
  }
}

function usedKey(key: string, file: string, node: AstNode | null | undefined): UsedKey {
  return node?.type === 'StringLiteral' ? { key, file } : { key, file, loose: true };
}

// a key is a literal however it is spelled: '…', `…` with no ${}, or {'…'} in a JSX attribute
function staticString(node: AstNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value as string;
  if (node.type === 'TemplateLiteral' && (node.expressions as AstNode[]).length === 0) {
    return cookedValue((node.quasis as AstNode[])[0]);
  }
  if (node.type === 'JSXExpressionContainer') return staticString(node.expression as AstNode);
  return undefined;
}

const VERBALY_PACKAGE = /^(?:verbaly|@verbaly\/[\w-]+)$/;

// the most plausible onboarding error: only the bundler used to complain, and never about verbaly
function collectStrayImports(node: AstNode, file: string, out: StrayImport[]): void {
  const source = node.source as { value?: unknown };
  if (typeof source.value !== 'string' || !VERBALY_PACKAGE.test(source.value)) return;
  for (const spec of node.specifiers as AstNode[]) {
    if (spec.type !== 'ImportSpecifier') continue;
    const imported = spec.imported as AstNode;
    if (imported.type !== 'Identifier') continue;
    const name = imported.name as string;
    // both come from virtual:verbaly, which is the project's module and never a package export
    if (name === 't' || name === DEFINE_KEYS) out.push({ name, source: source.value, file });
  }
}

function handleTrans(
  code: string,
  node: AstNode,
  file: string,
  tagged: TaggedMessage[],
  usedKeys: UsedKey[],
  names: ReadonlySet<string>,
): void {
  const opening = node.openingElement as AstNode;
  const nameNode = opening.name as AstNode;
  if (nameNode.type !== 'JSXIdentifier' || nameNode.name !== 'Trans') return;

  const attrs = opening.attributes as AstNode[];
  const idAttr = attrs.find((a) => a.type === 'JSXAttribute' && (a.name as AstNode).name === 'id');
  const children = node.children as AstNode[] | undefined;
  const push = (key: string, built: BuiltTrans) =>
    tagged.push({
      key,
      message: built.text,
      params: built.params,
      start: node.start,
      end: node.end,
      line: lineOf(node),
      tagStart: nameNode.start,
      tagEnd: nameNode.end,
      file,
      jsx: { name: nameNode.name as string, components: built.components },
    });

  if (idAttr) {
    const value = idAttr.value as AstNode | null;
    const id = staticString(value);
    if (id === undefined) return;
    // quoted id + children → extract under the explicit key; a backtick id never extracted before
    if (value?.type === 'StringLiteral' && attrs.length === 1 && children?.length) {
      const built = buildTransMessage(code, children, names);
      if (built?.text.trim()) {
        push(id, built);
        return;
      }
    }
    usedKeys.push(usedKey(id, file, value));
    return; // runtime-first, untouched
  }
  if (attrs.length > 0) return; // hand-written props → don't guess

  if (!children?.length) return;

  const built = buildTransMessage(code, children, names);
  if (!built || !built.text.trim()) return;

  push(stableKey(built.text), built);
}

// t.id('key')`…` → explicit readable key
function explicitId(
  tag: AstNode,
  names: ReadonlySet<string>,
): { key: string; refStart: number; refEnd: number } | undefined {
  if (tag.type !== 'CallExpression') return undefined;
  const callee = tag.callee as AstNode;
  if (callee.type !== 'MemberExpression' || callee.computed) return undefined;
  const prop = callee.property as AstNode;
  if (prop.type !== 'Identifier' || prop.name !== 'id') return undefined;
  const obj = callee.object as AstNode;
  if (!isTReference(obj, names)) return undefined;
  const args = tag.arguments as AstNode[];
  const first = args[0];
  // quoted only: extracting a backtick id now would be a new reason for a build to fail
  if (args.length !== 1 || first?.type !== 'StringLiteral') return undefined;
  return { key: first.value as string, refStart: obj.start, refEnd: obj.end };
}

interface BuiltTrans {
  text: string;
  params: TaggedParam[];
  components: TransComponent[];
}

function buildTransMessage(
  code: string,
  children: AstNode[],
  names: ReadonlySet<string>,
): BuiltTrans | undefined {
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
        if (containsTaggedT(expr, names)) return undefined; // overlap hazard
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
export function cleanJsxText(raw: string): string {
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
function containsTaggedT(node: AstNode, names: ReadonlySet<string>): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type !== 'TaggedTemplateExpression') return;
    const tag = n.tag as AstNode;
    if (isTReference(tag, names) || explicitId(tag, names)) found = true;
  });
  return found;
}

export function isTReference(node: AstNode, names: ReadonlySet<string>): boolean {
  if (node.type === 'Identifier') return names.has(node.name as string);
  if (node.type === 'MemberExpression' && !node.computed) {
    const prop = node.property as AstNode;
    return prop.type === 'Identifier' && names.has(prop.name as string);
  }
  return false;
}

interface BuiltMessage {
  text: string;
  params: TaggedParam[];
}

function buildMessage(
  code: string,
  quasi: AstNode,
  names: ReadonlySet<string>,
): BuiltMessage | undefined {
  const quasis = quasi.quasis as AstNode[];
  const expressions = quasi.expressions as AstNode[];
  const params: TaggedParam[] = [];
  const taken = new Map<string, string>();

  let text = escapeText(cookedValue(quasis[0]));

  for (let i = 0; i < expressions.length; i++) {
    const expr = expressions[i];
    if (!expr) return undefined;
    // a nested t`…` would be extracted on its own: overlapping rewrites; bail the outer
    if (containsTaggedT(expr, names)) return undefined;
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

export function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const key in node) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
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
