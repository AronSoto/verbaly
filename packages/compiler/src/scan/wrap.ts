import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import { glob } from 'tinyglobby';
import { cleanJsxText, FUNCTIONS, isTReference, walk, type AstNode } from './analyze';
import type { ResolvedConfig } from '../config/config';
import { componentAdapters } from '../config/host';
import { counted } from '../util/text';

export interface WrapEntry {
  file: string;
  line: number;
  text: string;
  kind: 'text' | 'attribute';
  attribute?: string;
}

export interface WrapSkip {
  file: string;
  line: number;
  text: string;
  reason: string;
}

// a file wrap could rewrite but will not, because the rewrite would not compile
export interface WrapBlocked {
  file: string;
  texts: number;
  client: boolean;
  // what to add so t is in scope, written for this project's framework and adapter
  binding: string;
}

export interface WrapResult {
  files: number;
  changed: string[];
  wrapped: WrapEntry[];
  skipped: WrapSkip[];
  blocked: WrapBlocked[];
}

export interface WrapOptions {
  write?: boolean;
}

// user-visible string attributes worth translating; everything else stays code
const WRAP_ATTRS = new Set(['title', 'alt', 'placeholder', 'aria-label']);

// their content is code or preformatted output, never interface copy
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'var']);

const T_NAMES: ReadonlySet<string> = new Set(['t']);
const LETTER = /\p{L}/u;
const WHITESPACE = /\s/;

// JSX renders with React unless the project's library is Vue, and Svelte writes none
const JSX_ADAPTERS: ReadonlySet<string> = new Set(['@verbaly/react', '@verbaly/vue']);

function jsxAdapters(root: string): string[] {
  const named = componentAdapters(root).filter((adapter) => JSX_ADAPTERS.has(adapter));
  return named.length > 0 ? named : ['@verbaly/react'];
}

// only Next splits a component into server and client; elsewhere a component reads the hook
function bindingFor(cfg: ResolvedConfig, adapters: () => string[], client: boolean): string {
  if (cfg.host !== 'next')
    return `in the component: \`const t = useT()\` from ${adapters().join(' or ')}`;
  const onClient = '`const t = useT()` from @verbaly/next/client';
  if (client) return `"use client", so ${onClient}`;
  return `no "use client": a Server Component takes \`const t = await getT()\` from @verbaly/next/server, a client one ${onClient}`;
}

// onboarding codemod: errs on skipping, never on inventing (ambiguous goes to the report)
export async function wrapProject(
  cfg: ResolvedConfig,
  options: WrapOptions = {},
): Promise<WrapResult> {
  const files = (
    await glob(cfg.include, { cwd: cfg.root, ignore: cfg.exclude, absolute: true })
  ).filter((file) => /\.[jt]sx$/.test(file));

  const result: WrapResult = {
    files: files.length,
    changed: [],
    wrapped: [],
    skipped: [],
    blocked: [],
  };
  // read package.json once, and only when a file outside Next needs the hint
  let found: string[] | undefined;
  const adapters = (): string[] => (found ??= jsxAdapters(cfg.root));

  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    const label = relative(cfg.root, file).replaceAll('\\', '/');
    const out = wrapCode(code, label);
    result.wrapped.push(...out.wrapped);
    result.skipped.push(...out.skipped);
    if (out.code === undefined) continue;
    result.changed.push(label);
    // writing a t call into a file with no t is how wrap left 32 files uncompilable
    if (!out.hasT) {
      const binding = bindingFor(cfg, adapters, out.client);
      result.blocked.push({ file: label, texts: out.wrapped.length, client: out.client, binding });
      continue;
    }
    if (options.write) writeFileSync(file, out.code);
  }
  return result;
}

export interface WrapCodeResult {
  code?: string;
  wrapped: WrapEntry[];
  skipped: WrapSkip[];
  hasT: boolean;
  client: boolean;
}

export function wrapCode(code: string, file: string): WrapCodeResult {
  const wrapped: WrapEntry[] = [];
  const skipped: WrapSkip[] = [];

  let ast: AstNode;
  try {
    ast = parse(code, {
      sourceType: 'module',
      errorRecovery: true,
      plugins: ['typescript', 'jsx'],
    }).program as unknown as AstNode;
  } catch {
    return { wrapped, skipped, hasT: false, client: false }; // unparseable file: leave it alone
  }

  const scopes = tScopes(ast);
  const client = hasDirective(ast, 'use client');
  const s = new MagicString(code);
  const visited = new Set<AstNode>();
  let changed = false;
  // every text wrap writes needs a t that reaches it: one that does not keeps the file waiting
  let reached = true;
  const write = (start: number, end: number, template: string): void => {
    s.overwrite(start, end, '{t`' + template + '`}');
    changed = true;
    if (!tReaches(scopes, start)) reached = false;
  };

  walk(ast, (node) => {
    if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return;
    if (visited.has(node)) return;
    processElement(node);
  });

  const hasT = changed ? reached : scopes.some((scope) => scope.bound);
  return changed
    ? { code: s.toString(), wrapped, skipped, hasT, client }
    : { wrapped, skipped, hasT, client };

  function processElement(node: AstNode): void {
    visited.add(node);

    if (node.type === 'JSXElement') {
      const opening = node.openingElement as AstNode;
      const name = opening.name as AstNode;
      // <Trans> children and data-verbaly subtrees are already message-managed
      if (name.type === 'JSXIdentifier' && name.name === 'Trans') return markSubtree(node);
      if (hasVerbalyAttr(opening)) return markSubtree(node);
      if (name.type === 'JSXIdentifier' && CODE_TAGS.has(name.name as string)) {
        return markSubtree(node);
      }
      wrapAttributes(opening);
    }

    const children = (node.children as AstNode[] | undefined) ?? [];
    const hasElementChild = children.some(
      (c) => c.type === 'JSXElement' || c.type === 'JSXFragment',
    );
    const hasText = children.some(
      (c) =>
        (c.type === 'JSXText' && LETTER.test(c.value as string)) ||
        (c.type === 'JSXExpressionContainer' &&
          (c.expression as AstNode).type === 'StringLiteral' &&
          LETTER.test((c.expression as AstNode).value as string)),
    );

    if (hasElementChild && hasText) {
      // splitting the sentence into fragments would ship broken translations
      skip(node, snippet(children), 'mixed text and markup: wrap by hand or use <Trans>');
      return markSubtree(node);
    }
    if (hasText) {
      wrapSegment(node, children);
      return markSubtree(node);
    }
    for (const child of children) {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') processElement(child);
    }
  }

  function wrapSegment(parent: AstNode, children: AstNode[]): void {
    const meaningful = children.filter(
      (c) =>
        (c.type === 'JSXText' && (c.value as string).trim() !== '') ||
        (c.type === 'JSXExpressionContainer' &&
          (c.expression as AstNode).type !== 'JSXEmptyExpression'),
    );
    if (meaningful.length === 0) return;

    const first = meaningful[0]!;
    const last = meaningful[meaningful.length - 1]!;

    // a message opening with an interpolation is a fragment: the translator never sees the sentence
    if (first.type === 'JSXExpressionContainer' && meaningful.length > 1) {
      skip(parent, snippet(children), 'starts with an interpolation: wrap the sentence by hand');
      return;
    }

    let template = '';
    let report = '';
    for (let i = children.indexOf(first); i <= children.indexOf(last); i++) {
      const child = children[i]!;
      if (child.type === 'JSXText') {
        let value = cleanJsxText(child.value as string);
        if (child === first) value = value.trimStart();
        if (child === last) value = value.trimEnd();
        template += escapeTemplate(value);
        report += value;
      } else if (child.type === 'JSXExpressionContainer') {
        const expr = child.expression as AstNode;
        if (expr.type === 'JSXEmptyExpression') continue;
        if (usesT(expr)) {
          skip(parent, snippet(children), 'already uses t: finish it by hand');
          return;
        }
        if (containsJsx(expr)) {
          skip(
            parent,
            snippet(children),
            'an expression renders markup: wrap by hand or use <Trans>',
          );
          markSubtree(child);
          return;
        }
        if (expr.type === 'StringLiteral') {
          template += escapeTemplate(expr.value as string);
          report += expr.value as string;
        } else {
          const source = code.slice(expr.start, expr.end);
          template += '${' + source + '}';
          report += '${' + source + '}';
        }
      } else {
        return; // spread children and friends: bail quietly
      }
    }
    if (!LETTER.test(report)) return;
    if (isIdentifierLike(report)) return;

    const start =
      first.type === 'JSXText' ? first.start + leadingWs(first.value as string) : first.start;
    const end = last.type === 'JSXText' ? last.end - trailingWs(last.value as string) : last.end;

    write(start, end, template);
    wrapped.push({ file, line: line(first), text: report, kind: 'text' });
  }

  function wrapAttributes(opening: AstNode): void {
    for (const attr of opening.attributes as AstNode[]) {
      if (attr.type !== 'JSXAttribute') continue;
      const name = attr.name as AstNode;
      if (name.type !== 'JSXIdentifier' || !WRAP_ATTRS.has(name.name as string)) continue;
      const value = attr.value as AstNode | null;
      if (value?.type !== 'StringLiteral') continue;
      const raw = value.value as string;
      if (!LETTER.test(raw) || isIdentifierLike(raw)) continue;
      write(value.start, value.end, escapeTemplate(raw));
      wrapped.push({
        file,
        line: line(value),
        text: raw,
        kind: 'attribute',
        attribute: name.name as string,
      });
    }
  }

  function skip(node: AstNode, text: string, reason: string): void {
    skipped.push({ file, line: line(node), text, reason });
  }

  function snippet(children: AstNode[]): string {
    const start = children[0]?.start ?? 0;
    const end = children[children.length - 1]?.end ?? start;
    const text = code.slice(start, end).replace(/\s+/g, ' ').trim();
    return text.length > 60 ? text.slice(0, 59) + '…' : text;
  }

  function markSubtree(node: AstNode): void {
    walk(node, (n) => {
      if (n.type === 'JSXElement' || n.type === 'JSXFragment') visited.add(n);
    });
  }
}

// one lowercase token with no space is a slug, a handle or a value, not a sentence someone wrote
function isIdentifierLike(text: string): boolean {
  const trimmed = text.trim();
  if (WHITESPACE.test(trimmed)) return false;
  const first = [...trimmed].find((char) => LETTER.test(char));
  return first !== undefined && first !== first.toUpperCase();
}

// a directive is the only way a file states which side it renders on
function hasDirective(program: AstNode, value: string): boolean {
  const directives = (program.directives as AstNode[] | undefined) ?? [];
  return directives.some((d) => ((d.value as AstNode | undefined)?.value as string) === value);
}

// a stretch of the file where t means one thing: verbaly's (bound), or a callback's own item
interface TScope {
  start: number;
  end: number;
  bound: boolean;
}

const CALLS = new Set(['CallExpression', 'NewExpression', 'OptionalCallExpression']);

// a t call written where nothing binds t does not compile, so wrap has to know before it writes
function tScopes(program: AstNode): TScope[] {
  const scopes: TScope[] = [];
  const mark = (scope: AstNode, bound: boolean): void => {
    scopes.push({ start: scope.start, end: scope.end, bound });
  };
  const visit = (node: AstNode, scope: AstNode, argument: boolean): void => {
    let inner = scope;
    if (FUNCTIONS.has(node.type)) {
      inner = node;
      if (node.type === 'FunctionDeclaration' && isTName((node.id as AstNode | null)?.name)) {
        mark(scope, true);
      }
      for (const param of (node.params as AstNode[] | undefined) ?? []) {
        if (!bindsT(param)) continue;
        // tabs.map((t) => …): that t is a tab; a destructured { t } is a prop someone passed down
        mark(node, !(argument && namesT(param)));
      }
    } else if (node.type === 'ImportDeclaration') {
      const locals = (node.specifiers as AstNode[]).map(
        (spec) => spec.local as AstNode | undefined,
      );
      if (locals.some((local) => isTName(local?.name))) mark(program, true);
      return;
    } else if (node.type === 'VariableDeclarator' && bindsT(node.id as AstNode)) {
      mark(scope, true);
    }
    const args = CALLS.has(node.type) ? (node.arguments as AstNode[]) : undefined;
    for (const key in node) {
      if (key === 'loc' || key.endsWith('Comments') || key === 'extra') continue;
      const value = node[key];
      for (const child of Array.isArray(value) ? value : [value]) {
        if (isAstNode(child)) visit(child, inner, args?.includes(child) ?? false);
      }
    }
  };
  visit(program, program, false);
  return scopes;
}

// the innermost stretch that says anything about t decides, and inside a callback's own t it is no
function tReaches(scopes: TScope[], position: number): boolean {
  let nearest: TScope | undefined;
  for (const scope of scopes) {
    if (position < scope.start || position >= scope.end) continue;
    const size = scope.end - scope.start;
    const best = nearest ? nearest.end - nearest.start : Infinity;
    if (size < best || (size === best && scope.bound)) nearest = scope;
  }
  return nearest?.bound ?? false;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof (value as { type?: unknown } | null)?.type === 'string';
}

// the parameter itself is called t, with or without a default
function namesT(param: AstNode): boolean {
  const target = param.type === 'AssignmentPattern' ? (param.left as AstNode) : param;
  return target.type === 'Identifier' && isTName(target.name);
}

function bindsT(pattern: AstNode | undefined): boolean {
  if (!pattern) return false;
  if (pattern.type === 'Identifier') return isTName(pattern.name);
  if (pattern.type === 'AssignmentPattern') return bindsT(pattern.left as AstNode);
  if (pattern.type === 'ObjectPattern') {
    return (pattern.properties as AstNode[]).some((prop) =>
      prop.type === 'RestElement'
        ? bindsT(prop.argument as AstNode)
        : bindsT(prop.value as AstNode),
    );
  }
  if (pattern.type === 'ArrayPattern') {
    return (pattern.elements as (AstNode | null)[]).some((el) => bindsT(el ?? undefined));
  }
  return false;
}

function isTName(name: unknown): boolean {
  return typeof name === 'string' && T_NAMES.has(name);
}

function hasVerbalyAttr(opening: AstNode): boolean {
  return (opening.attributes as AstNode[]).some((attr) => {
    if (attr.type !== 'JSXAttribute') return false;
    const name = attr.name as AstNode;
    return name.type === 'JSXIdentifier' && (name.name as string).startsWith('data-verbaly');
  });
}

// a t`…` / t(...) / t.id anywhere in the expression means a human already started here
function usesT(node: AstNode): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'TaggedTemplateExpression' && isTReference(n.tag as AstNode, T_NAMES)) {
      found = true;
    }
    if (n.type === 'CallExpression' && isTReference(n.callee as AstNode, T_NAMES)) found = true;
  });
  return found;
}

function containsJsx(node: AstNode): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === 'JSXElement' || n.type === 'JSXFragment') found = true;
  });
  return found;
}

// literal text run → template-literal-safe
function escapeTemplate(text: string): string {
  return text.replace(/[\\`]/g, '\\$&').replace(/\$\{/g, '\\${');
}

function leadingWs(text: string): number {
  return text.length - text.trimStart().length;
}

function trailingWs(text: string): number {
  return text.length - text.trimEnd().length;
}

function line(node: AstNode): number {
  const loc = node.loc as { start?: { line?: number } } | undefined;
  return loc?.start?.line ?? 1;
}

export interface WrapReport {
  // "would wrap 2 texts in 1 file", with what waits for t said apart
  counts: string;
  // each text, what needs a human, and the files it would not write, without the next step
  lines: string[];
  // files the run wrote, or would write: the caller's next step depends on it
  files: number;
}

// the words of a wrap run, written once for the CLI and for verbaly_wrap
export function formatWrapResult(result: WrapResult, write: boolean): WrapReport {
  const blocked = new Set(result.blocked.map((entry) => entry.file));
  const done = result.changed.filter((file) => !blocked.has(file));
  const texts = result.wrapped.filter((entry) => !blocked.has(entry.file));
  let counts = `${write ? 'wrapped' : 'would wrap'} ${counted(texts.length, 'text')} in ${counted(done.length, 'file')}`;
  // a report that promised texts a write then refused read as a bug: the wait is said up front
  const waiting = result.wrapped.length - texts.length;
  if (!write && waiting > 0) {
    counts += `, and ${counted(waiting, 'text')} in ${counted(blocked.size, 'file')} once t is in scope`;
  }
  const lines: string[] = [];
  for (const entry of write ? texts : result.wrapped) {
    const attr = entry.kind === 'attribute' ? `${entry.attribute} → ` : '';
    lines.push(`  ${entry.file}:${entry.line}  ${attr}"${entry.text}"`);
  }
  if (result.skipped.length > 0) {
    lines.push('  needs a human:');
    for (const entry of result.skipped) {
      lines.push(`  ${entry.file}:${entry.line}  "${entry.text}" (${entry.reason})`);
    }
  }
  if (result.blocked.length > 0) {
    lines.push(
      `  nothing written in ${counted(result.blocked.length, 'file')} with no t in scope:`,
    );
    for (const entry of result.blocked) {
      lines.push(`  ${entry.file}  ${counted(entry.texts, 'text')}, ${entry.binding}`);
    }
  }
  return { counts, lines, files: done.length };
}
