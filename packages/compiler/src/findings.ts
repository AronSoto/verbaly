import { relative } from 'node:path';
import type { TaggedMessage } from './analyze';
import type { ResolvedConfig } from './config';
import type { ReplacedText } from './extract';
import type { MessageRegistry } from './registry';
import type { OutdatedEntry } from './state';
import { counted, truncate } from './text';
import { escapedSyntax } from './validate';

// where a text is written in the code: an absolute file, like every path check reports
export interface SourceSite {
  file: string;
  line?: number;
  message: string;
}

export interface CollisionEntry {
  key: string;
  sites: SourceSite[];
}

// a source text the code wrote over; edited when the run knows a person changed the catalog
export interface ReplacedEntry {
  locale: string;
  key: string;
  before: string;
  site: SourceSite;
  edited?: boolean;
}

export interface RenamedEntry {
  name: string;
  file: string;
  line?: number;
}

export interface PositionalEntry {
  params: string[];
  site: SourceSite;
}

export interface EscapedEntry {
  slice: string;
  site: SourceSite;
}

export interface UnparsedEntry {
  file: string;
  message: string;
}

// what a scan finds that never fails a gate; every surface words it through formatFinding
export type Finding =
  | ({ kind: 'replaced' } & ReplacedEntry)
  | ({ kind: 'collision' } & CollisionEntry)
  | ({ kind: 'renamed' } & RenamedEntry)
  | ({ kind: 'positional' } & PositionalEntry)
  | ({ kind: 'escaped' } & EscapedEntry)
  | ({ kind: 'unparsed' } & UnparsedEntry)
  | ({ kind: 'outdated' } & OutdatedEntry);

export function siteOf(msg: TaggedMessage): SourceSite {
  return { file: msg.file, line: msg.line, message: msg.message };
}

export function collisionEntries(registry: MessageRegistry): CollisionEntry[] {
  return registry.collisions().map(({ key, kept, dropped }) => ({
    key,
    sites: [kept, ...dropped].map(siteOf),
  }));
}

// one pass, a fixed order: the same project always reads as the same report
export function scanFindings(
  cfg: ResolvedConfig,
  registry: MessageRegistry,
  replaced: ReplacedText[] = [],
): Finding[] {
  const messages = registry.messages();
  const out: Finding[] = [];
  for (const { key, before } of replaced) {
    const msg = messages.get(key);
    if (msg)
      out.push({ kind: 'replaced', locale: cfg.sourceLocale, key, before, site: siteOf(msg) });
  }
  for (const entry of collisionEntries(registry)) out.push({ kind: 'collision', ...entry });
  for (const { name, file, line } of registry.missed()) {
    out.push({ kind: 'renamed', name, file, line });
  }
  for (const msg of messages.values()) {
    // a translator who reads {_0} cannot know what goes there
    const params = msg.params.map((param) => param.name).filter((name) => /^_\d+$/.test(name));
    if (params.length > 0) out.push({ kind: 'positional', params, site: siteOf(msg) });
    const slice = escapedSyntax(msg.message);
    if (slice) out.push({ kind: 'escaped', slice, site: siteOf(msg) });
  }
  for (const { file, message } of registry.parseErrors()) {
    out.push({ kind: 'unparsed', file, message });
  }
  return out;
}

// file:line, so the editor and the terminal can jump to where the text is written
export function sourcePlace(at: { file: string; line?: number }, root?: string): string {
  const file = root ? relative(root, at.file).replaceAll('\\', '/') : at.file;
  return at.line ? `${file}:${at.line}` : file;
}

function quoted(at: SourceSite, root?: string): string {
  return `"${truncate(at.message, 40)}" (${sourcePlace(at, root)})`;
}

// the one wording of a collision, shared by extract, check, doctor and both dev servers
export function formatCollision({ key, sites }: CollisionEntry, root?: string): string {
  const [kept, ...others] = sites as [SourceSite, ...SourceSite[]];
  const texts = new Set(sites.map((at) => at.message)).size;
  return (
    `${key}: one key with ${counted(texts, 'text')}, and every place shows ${quoted(kept, root)}, ` +
    `never ${others.map((at) => quoted(at, root)).join(' or ')}: give each text its own key`
  );
}

// the one wording of every finding; each surface adds its own prefix or indent
export function formatFinding(finding: Finding, root?: string): string {
  switch (finding.kind) {
    case 'collision':
      return formatCollision(finding, root);
    case 'replaced': {
      const place = sourcePlace(finding.site, root);
      return finding.edited
        ? `${finding.locale}.json: your edit of "${finding.key}" was replaced, its text lives in ${place}: change it there`
        : `${finding.locale}: ${finding.key} follows the code (${place}): "${truncate(finding.site.message, 40)}", was "${truncate(finding.before, 40)}"`;
    }
    case 'renamed':
      return `${sourcePlace(finding, root)}: ${finding.name}\`…\` is never extracted, so it stays in the source language: name it t`;
    case 'positional': {
      const names = finding.params.map((name) => `{${name}}`).join(', ');
      return `${sourcePlace(finding.site, root)}: ${names} in "${truncate(finding.site.message, 60)}" reaches the translator without a name, put the value in a named variable first`;
    }
    case 'escaped':
      return `${sourcePlace(finding.site, root)}: ${finding.slice} renders as literal text, a tagged template has no params (use t(key, params) for a plural or format block, or pass a \${…} value)`;
    case 'unparsed':
      return `${sourcePlace(finding, root)}: could not be parsed (${finding.message}), its messages were not extracted`;
    case 'outdated':
      return `[${finding.locale}] ${finding.key}: translated from an older source text, update it or keep it with \`npx verbaly review --approve\``;
  }
}

// keyed on what a finding is about, never on its text: a dev server re-runs per keystroke
function findingId(finding: Finding): string {
  switch (finding.kind) {
    case 'collision':
    case 'replaced':
      return `${finding.kind}:${finding.key}`;
    case 'outdated':
      return `outdated:${finding.locale}:${finding.key}`;
    case 'renamed':
      return `renamed:${finding.file}:${finding.name}`;
    case 'positional':
      return `positional:${finding.site.file}:${finding.params.join(',')}`;
    case 'escaped':
      return `escaped:${finding.site.file}:${finding.slice}`;
    case 'unparsed':
      return `unparsed:${finding.file}`;
  }
}

export interface DevReporter {
  // prints what is new in this channel since its last report, and forgets what went away
  report(channel: string, findings: Finding[]): void;
}

// once per finding, and again only after it went away and came back; a few at a time
export function createDevReporter(
  root: string,
  print: (line: string) => void = (line) => console.warn(`[verbaly] ${line}`),
  cap = 5,
): DevReporter {
  const shown = new Map<string, Set<string>>();
  return {
    report(channel, findings) {
      const before = shown.get(channel) ?? new Set<string>();
      const now = new Set<string>();
      const fresh: Finding[] = [];
      for (const finding of findings) {
        const id = findingId(finding);
        if (now.has(id)) continue;
        now.add(id);
        if (!before.has(id)) fresh.push(finding);
      }
      shown.set(channel, now);
      for (const finding of fresh.slice(0, cap)) print(formatFinding(finding, root));
      if (fresh.length > cap)
        print(`and ${fresh.length - cap} more: \`npx verbaly doctor\` names them`);
    },
  };
}
