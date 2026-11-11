import { relative } from 'node:path';
import type { TaggedMessage } from '../scan/analyze';
import type { ResolvedConfig } from '../config/config';
import type { ReplacedText } from '../scan/extract';
import type { MessageRegistry } from '../scan/registry';
import type { Catalogs } from '../catalog/catalog';
import {
  outdatedTranslations,
  type LockEntry,
  type OutdatedEntry,
  type State,
} from '../catalog/state';
import { counted, truncate } from '../util/text';
import { escapedSyntax, inlineBlock, shownSlice } from './validate';

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

// what a run finds, or does, that never fails a gate; every surface words it through formatFinding
export type Finding =
  | ({ kind: 'replaced' } & ReplacedEntry)
  | ({ kind: 'collision' } & CollisionEntry)
  | ({ kind: 'renamed' } & RenamedEntry)
  | ({ kind: 'positional' } & PositionalEntry)
  | ({ kind: 'escaped' } & EscapedEntry)
  | ({ kind: 'unparsed' } & UnparsedEntry)
  | ({ kind: 'outdated' } & OutdatedEntry)
  | ({ kind: 'lock' } & LockEntry);

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
      return `${sourcePlace(finding.site, root)}: ${shownSlice(finding.slice)} renders as literal text: write ${inlineBlock(finding.slice)}`;
    case 'unparsed':
      return `${sourcePlace(finding, root)}: could not be parsed (${finding.message}), its messages were not extracted`;
    case 'outdated':
      return `[${finding.locale}] ${finding.key}: translated from an older source text, update it or keep it with \`npx verbaly review --approve\``;
    case 'lock': {
      const lock = sourcePlace(finding, root);
      if (finding.merged) {
        return `${lock} had a merge conflict and now holds both sides, drafts and stamps included: add it to the commit that resolves the merge`;
      }
      return finding.from
        ? `${sourcePlace({ file: finding.from }, root)} moved to ${lock}, next to your config: commit both changes`
        : `${lock} now keeps the source text each translation was made for and which ones are drafts: commit it with your catalogs`;
    }
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
    case 'lock':
      return `lock:${finding.merged ? 'merged:' : ''}${finding.file}`;
  }
}

// what a dev write-back hands its reporter: syncProject's result, or the part of it that speaks
export interface DevSync {
  findings: Finding[];
  catalogs: Catalogs;
  state?: State;
  stateProblem?: string;
}

export interface DevReporter {
  // prints what is new in this channel since its last report, and forgets what went away
  report(channel: string, findings: Finding[]): void;
  // everything one write-back says; edited judges a text the code wrote over, undefined drops it
  sync(
    cfg: ResolvedConfig,
    result: DevSync,
    edited: (finding: ReplacedEntry) => boolean | undefined,
  ): void;
}

// once per finding, and again only after it went away and came back; a few at a time
export function createDevReporter(
  root: string,
  print: (line: string) => void = (line) => console.warn(`[verbaly] ${line}`),
  cap = 5,
): DevReporter {
  const shown = new Map<string, Set<string>>();
  let stateBroken = false;
  const report = (channel: string, findings: Finding[]): void => {
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
  };
  return {
    report,
    sync(cfg, result, edited) {
      const replaced: Finding[] = [];
      const code: Finding[] = [];
      const lock: Finding[] = [];
      for (const finding of result.findings) {
        if (finding.kind === 'collision' || finding.kind === 'renamed') code.push(finding);
        else if (finding.kind === 'lock') lock.push(finding);
        else if (finding.kind === 'replaced') {
          // only the caller knows whether a person edited the catalog or the code moved on
          const answer = edited(finding);
          if (answer !== undefined) replaced.push({ ...finding, edited: answer });
        }
      }
      report('replaced', replaced);
      report('code', code);
      report('lock', lock);
      const outdated = result.state
        ? outdatedTranslations(cfg, result.catalogs, result.state.fingerprints)
        : [];
      report(
        'outdated',
        outdated.map((entry): Finding => ({ kind: 'outdated', ...entry })),
      );
      // a broken lock must not stop a dev server: said once, and again if it breaks after a fix
      if (result.stateProblem && !stateBroken) {
        print(`${result.stateProblem}, so drafts are not tracked`);
      }
      stateBroken = Boolean(result.stateProblem);
    },
  };
}
