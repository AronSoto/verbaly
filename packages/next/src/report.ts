import type { ResolvedConfig } from '@verbaly/compiler';
import { relative } from 'node:path';
import type { Compiler, Registry } from './codegen';

// a dev server re-runs per keystroke: keyed on what it is about, never on the text being typed
const said = new Set<string>();

function once(id: string, line: string): void {
  if (said.has(id)) return;
  said.add(id);
  console.warn(`[verbaly] ${line}`);
}

// the code texts of the last run tell an edit in the code from an edit in the catalog
export type CodeTexts = Map<string, string>;

export function reportDev(
  compiler: Compiler,
  cfg: ResolvedConfig,
  registry: Registry,
  replaced: string[],
  previous: CodeTexts | undefined,
  outdated: { locale: string; key: string }[],
): CodeTexts {
  const messages = registry.messages();
  const rel = (file: string): string => relative(cfg.root, file).replaceAll('\\', '/');
  for (const key of replaced) {
    const msg = messages.get(key);
    // the code changed this text since the last run, which is how a text it owns is edited
    if (!msg || (previous && previous.get(key) !== msg.message)) continue;
    once(
      `replaced:${key}`,
      previous
        ? `${cfg.sourceLocale}.json: your edit of "${key}" was replaced, its text lives in ${rel(msg.file)}: change it there`
        : `${cfg.sourceLocale}.json: "${key}" took the text written in ${rel(msg.file)}, the code owns it`,
    );
  }
  for (const entry of compiler.collisionEntries(registry)) {
    once(`collision:${entry.key}`, compiler.formatCollision(entry, cfg.root).trim());
  }
  for (const { name, file } of registry.missed()) {
    once(
      `missed:${file}:${name}`,
      `${rel(file)}: ${name}\`…\` is never extracted, so it stays in the source language: name it t`,
    );
  }
  for (const { locale, key } of outdated) {
    once(
      `outdated:${locale}:${key}`,
      `${locale}: "${key}" was translated from an older source text, update it or approve it`,
    );
  }
  return new Map([...messages].map(([key, msg]) => [key, msg.message]));
}

// test hook: the set is module state, and each test starts from a server that said nothing
export function resetReported(): void {
  said.clear();
}
