import { parse } from '@babel/parser';
import type * as babel from '@babel/types';
import { isAppModule } from '../util/ids';
import { stableKey } from '../util/key';

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
  // the key of a text never extracted (a t under another name): prune keeps it, check never asks
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
  // where the first adapter import starts: its hooks read verbaly/app's instance with no provider
  adapterImport?: number;
  // the file loads verbaly/app itself, under either name
  appImported?: true;
}

// babel's message carries the position but never the path: every caller adds the file itself
export function parseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// the parser sets start and end on every node: babel's types leave them optional for built ones
type Parsed<T> = T extends babel.Node
  ? { [K in keyof T]: Parsed<T[K]> } & { start: number; end: number }
  : T extends readonly (infer U)[]
    ? Parsed<U>[]
    : T;

// exported for wrap.ts (module-internal reuse, not part of the package surface)
export type AstNode = Parsed<babel.Node>;

// the node of one type, which is what a check of node.type leaves
export type NodeOf<T extends AstNode['type']> = Extract<AstNode, { type: T }>;

// what can load another module: an import, or an export that passes one on
type Loading = NodeOf<'ImportDeclaration' | 'ExportNamedDeclaration' | 'ExportAllDeclaration'>;

// the two fields that say types only, under babel's own names: a node has one of them or none
type Kinds = { type: string } & Partial<
  Pick<NodeOf<'ImportSpecifier'>, 'importKind'> & Pick<NodeOf<'ExportSpecifier'>, 'exportKind'>
>;

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
type Candidate =
  | { kind: 'tag'; node: NodeOf<'TaggedTemplateExpression'> }
  | { kind: 'call'; name: string; key: string };

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
  }) as Parsed<babel.File>;

  const tagged: TaggedMessage[] = [];
  const usedKeys: UsedKey[] = [];
  const strayImports: StrayImport[] = [];
  const bindings = new Bindings(names);
  const candidates: Candidate[] = [];
  let adapterImport: number | undefined;
  let appImported = false;

  // an import or an `export … from`: a file that passes an adapter on loads it for its importers
  const noteLoad = (node: Loading): void => {
    const source = node.source?.value;
    if (typeof source !== 'string' || !loadsAtRuntime(node)) return;
    if (isAppModule(source)) appImported = true;
    else if (ADAPTER_SOURCE.test(source)) adapterImport ??= node.start;
  };

  // imports are hoisted, and where a name came from decides what the rest of the file means
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      collectStrayImports(node, file, strayImports);
      bindings.addImport(node);
      noteLoad(node);
    } else if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      noteLoad(node);
    }
  }
  const ownTrans = !bindings.other(TRANS);

  const program: AstNode = ast.program;
  // visited parents first, so the last function that holds a node is the one it sits in
  const functions: AstNode[] = [];
  const scopeOf = (node: AstNode): AstNode => {
    for (let i = functions.length - 1; i >= 0; i--) {
      if (node.start >= functions[i]!.start && node.end <= functions[i]!.end) return functions[i]!;
    }
    return program;
  };

  walk(program, (node) => {
    if (FUNCTIONS.has(node.type)) functions.push(node);
    if (node.type === 'VariableDeclarator') {
      bindings.addDeclarator(node, scopeOf(node));
    } else if (node.type === 'TaggedTemplateExpression') {
      const tag = node.tag;
      const explicit = explicitId(tag, names);
      if (!explicit && !isTReference(tag, names)) {
        candidates.push({ kind: 'tag', node });
        return;
      }
      const quasi = node.quasi;
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
      const callee = node.callee;
      const args = node.arguments;
      if (callee.type === 'Identifier' && callee.name === DEFINE_KEYS) {
        collectDeclaredKeys(args[0], file, usedKeys);
        return;
      }
      if (!isTReference(callee, names)) {
        const key = callee.type === 'Identifier' ? staticString(args[0]) : undefined;
        if (key !== undefined)
          candidates.push({ kind: 'call', name: (callee as NodeOf<'Identifier'>).name, key });
        return;
      }
      const key = staticString(args[0]);
      if (key !== undefined) usedKeys.push({ key, file });
    } else if (ownTrans && node.type === 'JSXElement') {
      handleTrans(code, node, file, tagged, usedKeys, names);
    }
  });

  // a tagged t of Lingui or ttag is theirs to compile: rewriting it breaks a page that worked
  const kept = tagged.filter((entry) => {
    const name = code.slice(entry.tagStart, entry.tagEnd);
    return entry.jsx || !names.has(name) || !bindings.foreign(name, entry.tagStart);
  });
  if (kept.length < tagged.length) tagged.splice(0, tagged.length, ...kept);

  const renamed = bindings.renamed(options.renamed);
  const missed: MissedCall[] = [];
  for (const candidate of candidates) {
    // a key read under another name is still a key someone wrote: prune keeps it, check knows it
    if (candidate.kind === 'call') {
      if (renamed.has(candidate.name)) usedKeys.push({ key: candidate.key, file });
      continue;
    }
    const { node } = candidate;
    const name = renamedTag(node.tag, renamed);
    if (!name) continue;
    missed.push({ name, file, start: node.start, line: lineOf(node) });
    // never extracted, yet its translation has to outlive prune until the binding is named t
    const key = missedKey(code, node, names);
    if (key !== undefined) usedKeys.push({ key, file, loose: true });
  }

  const analysis: Analysis = { tagged, usedKeys, strayImports, missed };
  if (adapterImport !== undefined) analysis.adapterImport = adapterImport;
  if (appImported) analysis.appImported = true;
  return { analysis, renamed: [...renamed] };
}

// the adapters whose hooks fall back to verbaly/app's instance; a server entry takes one passed in
const ADAPTER_SOURCE = /^@verbaly\/(?:react|vue|svelte)(?:\/Trans\.svelte)?$/;

// what survives compilation: not `import type`, not `export type`, and not `{ type X }` alone
function loadsAtRuntime(node: Kinds & { specifiers?: Kinds[] }): boolean {
  if (node.importKind === 'type' || node.exportKind === 'type') return false;
  const specifiers = node.specifiers ?? [];
  if (specifiers.length === 0) return true;
  return specifiers.some((spec) => spec.importKind !== 'type' && spec.exportKind !== 'type');
}

export function lineOf(node: AstNode): number {
  const loc = node.loc;
  return loc?.start?.line ?? 1;
}

// the i18n libraries a project migrating in parts still imports a t or a Trans from
const OTHER_I18N = /^(?:react-i18next|next-i18next|next-translate|ttag|@lingui\/[\w-]+)(?:\/.*)?$/;
const TRANS = 'Trans';

// what hands out verbaly's t: the core and every adapter; isAppModule covers the project's
const VERBALY_SOURCE = /^(?:verbaly|@verbaly\/[\w-]+(?:\/[\w-]+)*)$/;

// how each factory hands out t: useT() returns it, getT() resolves to it
const T_FACTORIES = new Map([
  ['useT', 'call'],
  ['getT', 'await'],
]);

// instance factories whose result carries t, for const { t: x } = useVerbaly() with no import
const INSTANCE_FACTORIES = new Set(['useVerbaly', 'getVerbaly']);

// a declaration, with the function (or the program) it was written in
interface Declared {
  name: string;
  init: AstNode;
  scope: AstNode;
}

// exported for wrap.ts, which asks the same question about a t: what a function is
export const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

// what hands out a t in this file, judged by where each name was imported from
class Bindings {
  private imports = new Map<string, { source: string; imported: string }>();
  private direct = new Set<string>();
  private declared: Declared[] = [];
  private destructured: Declared[] = [];

  constructor(private names: ReadonlySet<string>) {}

  addImport(node: NodeOf<'ImportDeclaration'>): void {
    const source = node.source.value;
    if (typeof source !== 'string') return;
    for (const spec of node.specifiers) {
      const local = identifierName(spec.local);
      if (!local) continue;
      const imported = spec.type === 'ImportSpecifier' ? importedName(spec.imported) : spec.type;
      this.imports.set(local, { source, imported });
      if (isAppModule(source) && imported === 't') this.direct.add(local);
    }
  }

  addDeclarator(node: NodeOf<'VariableDeclarator'>, scope: AstNode): void {
    const id = node.id;
    const init = node.init;
    if (!init) return;
    if (id.type === 'Identifier') {
      this.declared.push({ name: id.name, init, scope });
      return;
    }
    if (id.type !== 'ObjectPattern') return;
    for (const property of id.properties) {
      if (property.type !== 'ObjectProperty' || property.computed) continue;
      if (identifierName(property.key) !== 't') continue;
      const value = property.value;
      // { t: x = fallback } binds x all the same
      const target = value.type === 'AssignmentPattern' ? value.left : value;
      const name = identifierName(target);
      if (name) this.destructured.push({ name, init, scope });
    }
  }

  // the name was imported from another i18n library
  other(local: string): boolean {
    return OTHER_I18N.test(this.imports.get(local)?.source ?? '');
  }

  // whose the name is at that place: the nearest function that declares it wins over the import
  foreign(name: string, at: number): boolean {
    let theirs = this.other(name);
    let reach = Infinity;
    for (const { name: bound, init, scope } of [...this.declared, ...this.destructured]) {
      if (bound !== name || at < scope.start || at >= scope.end) continue;
      if (scope.end - scope.start >= reach) continue;
      reach = scope.end - scope.start;
      const inner = init.type === 'AwaitExpression' ? init.argument : init;
      const read = inner.type === 'CallExpression' ? inner.callee : inner;
      theirs = this.other(identifierName(read));
    }
    return theirs;
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
    const call = awaited ? init.argument : init;
    if (call.type !== 'CallExpression') return false;
    const origin = this.origin(identifierName(call.callee));
    if (origin.verbaly === false) return false;
    const how = T_FACTORIES.get(origin.imported);
    return how !== undefined && (how === 'await') === awaited;
  }

  // { t: x } reads from something verbaly handed out, or from an auto-imported instance factory
  private carriesT(init: AstNode): boolean {
    const inner = init.type === 'AwaitExpression' ? init.argument : init;
    const read = inner.type === 'CallExpression' ? inner.callee : inner;
    const name = identifierName(read);
    if (!name) return false;
    const origin = this.origin(name);
    return origin.verbaly ?? INSTANCE_FACTORIES.has(name);
  }

  private origin(local: string): { verbaly: boolean | undefined; imported: string } {
    const found = this.imports.get(local);
    if (!found) return { verbaly: undefined, imported: local };
    const verbaly = VERBALY_SOURCE.test(found.source) || isAppModule(found.source);
    return { verbaly, imported: found.imported };
  }
}

function importedName(node: AstNode): string {
  return node.type === 'StringLiteral' ? node.value : identifierName(node);
}

function identifierName(node: AstNode | null | undefined): string {
  return node?.type === 'Identifier' ? node.name : '';
}

// x`…` or x.id('…')`…` where x is a renamed t
function renamedTag(tag: AstNode, renamed: ReadonlySet<string>): string | undefined {
  if (renamed.size === 0) return undefined;
  const name = identifierName(tag);
  if (renamed.has(name)) return name;
  const call = idCall(tag);
  if (!call) return undefined;
  const object = identifierName(call.object);
  return renamed.has(object) ? object : undefined;
}

// x.id('…'): what the id hangs from, and its key when the one argument is a literal
function idCall(tag: AstNode): { object: AstNode; key: string | undefined } | undefined {
  if (tag.type !== 'CallExpression') return undefined;
  const callee = tag.callee;
  if (callee.type !== 'MemberExpression' || callee.computed) return undefined;
  if (identifierName(callee.property) !== 'id') return undefined;
  const args = tag.arguments;
  return {
    object: callee.object,
    key: args.length === 1 ? staticString(args[0]) : undefined,
  };
}

// the key a tagged template on a renamed t would have had: its quoted id, or its text's hash
function missedKey(
  code: string,
  node: NodeOf<'TaggedTemplateExpression'>,
  names: ReadonlySet<string>,
): string | undefined {
  const tag = node.tag;
  // a renamed tag that is a call is x.id('…'), the only call renamedTag lets through
  if (tag.type === 'CallExpression') return idCall(tag)?.key;
  const message = buildMessage(code, node.quasi, names);
  return message ? stableKey(message.text) : undefined;
}

// every string leaf is a key: the call is the author saying so, and '' still means untranslated
function collectDeclaredKeys(node: AstNode | undefined, file: string, out: UsedKey[]): void {
  if (node?.type !== 'ObjectExpression') return;
  for (const property of node.properties) {
    if (property.type !== 'ObjectProperty') continue;
    const value = property.value;
    const key = staticString(value);
    if (key !== undefined) {
      if (key !== '') out.push({ key, file });
    } else if (value.type === 'ObjectExpression') {
      collectDeclaredKeys(value, file, out);
    }
  }
}

// a key is a literal however it is spelled: '…', `…` with no ${}, or {'…'} in a JSX attribute
function staticString(node: AstNode | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return cookedValue(node.quasis[0]);
  }
  if (node.type === 'JSXExpressionContainer') return staticString(node.expression);
  return undefined;
}

// the most plausible onboarding error: only the bundler used to complain, and never about verbaly
function collectStrayImports(
  node: NodeOf<'ImportDeclaration'>,
  file: string,
  out: StrayImport[],
): void {
  const source = node.source;
  // every entry of a package, @verbaly/react/server too: verbaly/app is the project's and passes
  if (typeof source.value !== 'string' || !VERBALY_SOURCE.test(source.value)) return;
  for (const spec of node.specifiers) {
    if (spec.type !== 'ImportSpecifier') continue;
    const imported = spec.imported;
    if (imported.type !== 'Identifier') continue;
    const name = imported.name;
    // both come from verbaly/app, which is the project's module and never a package export
    if (name === 't' || name === DEFINE_KEYS) out.push({ name, source: source.value, file });
  }
}

function handleTrans(
  code: string,
  node: NodeOf<'JSXElement'>,
  file: string,
  tagged: TaggedMessage[],
  usedKeys: UsedKey[],
  names: ReadonlySet<string>,
): void {
  const opening = node.openingElement;
  const nameNode = opening.name;
  if (nameNode.type !== 'JSXIdentifier' || nameNode.name !== TRANS) return;

  const attrs = opening.attributes;
  const idAttr = attrs.find(
    (a): a is NodeOf<'JSXAttribute'> => a.type === 'JSXAttribute' && a.name.name === 'id',
  );
  const children: AstNode[] | undefined = node.children;
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
      jsx: { name: nameNode.name, components: built.components },
    });

  if (idAttr) {
    const value = idAttr.value;
    const id = staticString(value);
    if (id === undefined) return;
    // a fixed id + children → extract under the explicit key, however the id is spelled
    if (attrs.length === 1 && children?.length) {
      const built = buildTransMessage(code, children, names);
      if (built?.text.trim()) {
        push(id, built);
        return;
      }
    }
    usedKeys.push({ key: id, file });
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
  const call = idCall(tag);
  if (!call || !isTReference(call.object, names) || call.key === undefined) return undefined;
  return { key: call.key, refStart: call.object.start, refEnd: call.object.end };
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
        text += escapeText(cleanJsxText(child.value));
      } else if (child.type === 'JSXExpressionContainer') {
        const expr = child.expression;
        if (expr.type === 'JSXEmptyExpression') continue;
        if (expr.type === 'StringLiteral') {
          text += escapeText(expr.value);
          continue;
        }
        if (containsTaggedT(expr, names)) return undefined; // overlap hazard
        const source = code.slice(expr.start, expr.end);
        const name = uniqueName(deriveName(expr, params.length), source, takenParams);
        params.push({ name, start: expr.start, end: expr.end });
        text += `{${name}}`;
      } else if (child.type === 'JSXElement') {
        const opening = child.openingElement;
        const nameNode = opening.name;
        if (nameNode.type !== 'JSXIdentifier' || nameNode.name === 'Trans') return undefined;
        const source = selfClosedSource(code, opening);
        const tag = uniqueName(nameNode.name.toLowerCase(), source, takenTags);
        if (!components.some((c) => c.name === tag)) components.push({ name: tag, source });
        if (!child.closingElement) {
          text += `<${tag}/>`;
        } else {
          const inner = walkChildren(child.children);
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
    const tag = n.tag;
    if (isTReference(tag, names) || explicitId(tag, names)) found = true;
  });
  return found;
}

export function isTReference(node: AstNode, names: ReadonlySet<string>): boolean {
  if (node.type === 'Identifier') return names.has(node.name);
  if (node.type === 'MemberExpression' && !node.computed) {
    const prop = node.property;
    return prop.type === 'Identifier' && names.has(prop.name);
  }
  return false;
}

interface BuiltMessage {
  text: string;
  params: TaggedParam[];
}

// after `{${value}`, a variant (`| one:`) or a format right after the colon makes it a block
const BLOCK_TAIL = /^(?:\s*\|\s*[^\s|{}:]+\s*:|:[A-Za-z_][\w-]*)/;

function buildMessage(
  code: string,
  quasi: NodeOf<'TemplateLiteral'>,
  names: ReadonlySet<string>,
): BuiltMessage | undefined {
  const quasis = quasi.quasis;
  const expressions = quasi.expressions;
  const texts = quasis.map(cookedValue);
  const params: TaggedParam[] = [];
  const taken = new Map<string, string>();
  const tokens: Token[] = [];

  for (let i = 0; i < texts.length; i++) {
    const chunk = texts[i]!;
    const head = i < expressions.length && chunk.endsWith('{') && BLOCK_TAIL.test(texts[i + 1]!);
    // one at a time: spreading a long text into push() overflows the call stack
    for (const char of head ? chunk.slice(0, -1) : chunk) tokens.push(char);
    if (i === expressions.length) break;

    const expr = expressions[i];
    if (!expr) return undefined;
    // a nested t`…` would be extracted on its own: overlapping rewrites; bail the outer
    if (containsTaggedT(expr, names)) return undefined;
    const source = code.slice(expr.start, expr.end);
    const name = uniqueName(deriveName(expr, i), source, taken);
    params.push({ name, start: expr.start, end: expr.end });
    tokens.push({ name, head });
  }

  let text = '';
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]!;
    if (typeof token === 'string') {
      text += token === '{' || token === '}' ? token + token : token;
    } else if (!token.head) {
      text += `{${token.name}}`;
    } else {
      // a block closes where the core's findClose closes it, and its body is catalog syntax
      const end = blockEnd(tokens, k, false) ?? blockEnd(tokens, k, true);
      // a block that never closes was never one: the template reads as text, with the key it had
      if (end === undefined) {
        const plain = texts.map(
          (chunk, i) => escapeText(chunk) + (params[i] ? `{${params[i].name}}` : ''),
        );
        return { text: plain.join(''), params };
      }
      for (let m = k; m <= end; m++) text += tokenText(tokens[m]!);
      k = end;
    }
  }
  return { text, params };
}

// a character of the template, or a ${…} value: `head` when it opens a block (`{${count} |`)
type Token = string | { name: string; head: boolean };

function tokenText(token: Token): string {
  if (typeof token === 'string') return token;
  return token.head ? `{${token.name}` : `{${token.name}}`;
}

// }} is an escaped brace unless reading it so leaves the block open, as core's findClose reads it
function blockEnd(tokens: Token[], start: number, pairs: boolean): number | undefined {
  let depth = 0;
  // a format block's head has no escapes: its first } closes it, and a } after that is text
  let head = true;
  for (let k = start; k < tokens.length; k++) {
    const token = tokens[k]!;
    if (typeof token !== 'string') {
      if (token.head) depth += 1;
    } else if (token === '|' && depth === 1) {
      head = false;
    } else if (token === '}' && head && depth === 1) {
      return k;
    } else if (token === '{' || token === '}') {
      if (tokens[k + 1] === token && (token === '{' || !(pairs && depth > 1))) {
        k += 1;
      } else {
        depth += token === '{' ? 1 : -1;
        if (depth === 0) return k;
      }
    }
  }
  return undefined;
}

function cookedValue(element: NodeOf<'TemplateElement'> | undefined): string {
  if (!element) return '';
  const value = element.value;
  return value.cooked ?? value.raw;
}

// literal braces → escaped
function escapeText(text: string): string {
  return text.replace(/[{}]/g, (m) => m + m);
}

function deriveName(expr: AstNode, index: number): string {
  if (expr.type === 'Identifier') return expr.name;
  if (expr.type === 'MemberExpression' && !expr.computed) {
    const prop = expr.property;
    if (prop.type === 'Identifier') return prop.name;
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
    const value = (node as unknown as Record<string, unknown>)[key];
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
