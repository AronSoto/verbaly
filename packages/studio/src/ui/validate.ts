import { parse, parseTags } from 'verbaly';

// The browser preview of the gate, on the runtime's own parser: the server is still the authority.
export interface Preview {
  params: { name: string; inSource: boolean; inTarget: boolean }[];
  problems: string[];
}

type Node = { kind: string; name?: string; variants?: [string, Node[]][] };

function walk(nodes: Node[], out: Map<string, Set<string>>): void {
  for (const node of nodes) {
    if (node.kind === 'param' && node.name) {
      if (!out.has(node.name)) out.set(node.name, new Set());
      for (const [selector, body] of node.variants ?? []) {
        out.get(node.name)!.add(selector);
        walk(body, out);
      }
    }
  }
}

function shape(message: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  try {
    walk(parse(message) as Node[], out);
  } catch {
    // a half-typed message is not a defect, so an unparseable draft simply reports nothing yet
  }
  return out;
}

type Token = string | { name: string; children: Token[] };

function collect(tokens: Token[], out: string[]): void {
  for (const token of tokens) {
    if (typeof token === 'string') continue;
    out.push(token.name);
    collect(token.children, out);
  }
}

function tags(message: string): string[] {
  const out: string[] = [];
  try {
    collect(parseTags(message) as Token[], out);
  } catch {
    return out;
  }
  return out;
}

function counted(list: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of list) out.set(item, (out.get(item) ?? 0) + 1);
  return out;
}

const list = (names: string[]) =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function preview(source: string, translated: string): Preview {
  const from = shape(source);
  const to = shape(translated);
  const params = [...new Set([...from.keys(), ...to.keys()])].sort().map((name) => ({
    name,
    inSource: from.has(name),
    inTarget: to.has(name),
  }));

  const problems: string[] = [];
  const lost = params.filter((p) => p.inSource && !p.inTarget).map((p) => `{${p.name}}`);
  const made = params.filter((p) => !p.inSource && p.inTarget).map((p) => `{${p.name}}`);
  if (lost.length) problems.push(`${list(lost)} is missing, so its value never reaches the text`);
  if (made.length) problems.push(`${list(made)} is not in the source, so it renders as literal text`);

  // a plural block that lost its catch-all renders nothing for any count it does not list
  for (const [name, selectors] of to) {
    if (selectors.size && !selectors.has('other')) {
      problems.push(`the block for {${name}} has no "other" case, so some counts render empty`);
    }
  }

  const sourceTags = counted(tags(source));
  const targetTags = counted(tags(translated));
  for (const [name, n] of sourceTags) {
    if ((targetTags.get(name) ?? 0) < n) problems.push(`<${name}> is missing from the translation`);
  }
  for (const [name, n] of targetTags) {
    if ((sourceTags.get(name) ?? 0) < n) problems.push(`<${name}> is not in the source message`);
  }

  return { params, problems };
}
