import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parse } from '@babel/parser';
import MagicString from 'magic-string';
import { glob } from 'tinyglobby';
import { cleanJsxText, isTReference, walk, type AstNode } from './analyze';
import type { ResolvedConfig } from './config';

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

export interface WrapResult {
  files: number;
  changed: string[];
  wrapped: WrapEntry[];
  skipped: WrapSkip[];
}

export interface WrapOptions {
  write?: boolean;
}

// user-visible string attributes worth translating; everything else stays code
const WRAP_ATTRS = new Set(['title', 'alt', 'placeholder', 'aria-label']);

const T_NAMES: ReadonlySet<string> = new Set(['t']);
const LETTER = /\p{L}/u;

// onboarding codemod: errs on skipping, never on inventing (ambiguous goes to the report)
export async function wrapProject(
  cfg: ResolvedConfig,
  options: WrapOptions = {},
): Promise<WrapResult> {
  const files = (
    await glob(cfg.include, { cwd: cfg.root, ignore: cfg.exclude, absolute: true })
  ).filter((file) => /\.[jt]sx$/.test(file));

  const result: WrapResult = { files: files.length, changed: [], wrapped: [], skipped: [] };

  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    const label = relative(cfg.root, file).replaceAll('\\', '/');
    const out = wrapCode(code, label);
    result.wrapped.push(...out.wrapped);
    result.skipped.push(...out.skipped);
    if (out.code !== undefined) {
      result.changed.push(label);
      if (options.write) writeFileSync(file, out.code);
    }
  }
  return result;
}

export interface WrapCodeResult {
  code?: string;
  wrapped: WrapEntry[];
  skipped: WrapSkip[];
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
    return { wrapped, skipped }; // unparseable file: leave it alone
  }

  const s = new MagicString(code);
  const visited = new Set<AstNode>();
  let changed = false;

  walk(ast, (node) => {
    if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return;
    if (visited.has(node)) return;
    processElement(node);
  });

  return changed ? { code: s.toString(), wrapped, skipped } : { wrapped, skipped };

  function processElement(node: AstNode): void {
    visited.add(node);

    if (node.type === 'JSXElement') {
      const opening = node.openingElement as AstNode;
      const name = opening.name as AstNode;
      // <Trans> children and data-verbaly subtrees are already message-managed
      if (name.type === 'JSXIdentifier' && name.name === 'Trans') return markSubtree(node);
      if (hasVerbalyAttr(opening)) return markSubtree(node);
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

    const start =
      first.type === 'JSXText' ? first.start + leadingWs(first.value as string) : first.start;
    const end = last.type === 'JSXText' ? last.end - trailingWs(last.value as string) : last.end;

    s.overwrite(start, end, '{t`' + template + '`}');
    changed = true;
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
      if (!LETTER.test(raw)) continue;
      s.overwrite(value.start, value.end, '{t`' + escapeTemplate(raw) + '`}');
      changed = true;
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
