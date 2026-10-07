import type { Analysis, MissedCall, StrayImport, TaggedMessage } from './analyze';

// one key, several texts: the earliest one wins everywhere, so the others render its words
export interface Collision {
  key: string;
  kept: TaggedMessage;
  dropped: TaggedMessage[];
}

export class MessageRegistry {
  private files = new Map<string, Analysis>();

  update(file: string, analysis: Analysis): void {
    this.files.set(file, analysis);
  }

  remove(file: string): void {
    this.files.delete(file);
  }

  // the earliest site wins, by file then position, so no scan or load order ever picks the text
  messages(): Map<string, TaggedMessage> {
    const out = new Map<string, TaggedMessage>();
    for (const analysis of this.inOrder()) {
      for (const msg of analysis.tagged) {
        const held = out.get(msg.key);
        if (!held || earlier(msg, held)) out.set(msg.key, msg);
      }
    }
    return out;
  }

  // every place whose text differs from the one that wins, so fixing one never hides the next
  collisions(): Collision[] {
    const winners = this.messages();
    const dropped = new Map<string, TaggedMessage[]>();
    for (const analysis of this.inOrder()) {
      for (const msg of analysis.tagged) {
        if (msg.message === winners.get(msg.key)!.message) continue;
        dropped.set(msg.key, [...(dropped.get(msg.key) ?? []), msg]);
      }
    }
    return [...dropped].map(([key, others]) => ({
      key,
      kept: winners.get(key)!,
      dropped: others.sort((a, b) => (earlier(a, b) ? -1 : 1)),
    }));
  }

  // strict leaves out the loose spellings, which the gate does not fail on yet
  usedKeys(strict = false): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const analysis of this.inOrder()) {
      for (const used of analysis.usedKeys) {
        if (strict && used.loose) continue;
        const files = out.get(used.key) ?? [];
        if (!files.includes(used.file)) files.push(used.file);
        out.set(used.key, files);
      }
    }
    return out;
  }

  strayImports(): StrayImport[] {
    return this.inOrder().flatMap((analysis) => analysis.strayImports);
  }

  // a t under another name: its texts are neither extracted nor rewritten, so they never translate
  missed(): MissedCall[] {
    return this.inOrder().flatMap((analysis) => analysis.missed);
  }

  // files the parser could not read: they contributed no messages and nothing else can tell
  parseErrors(): { file: string; message: string }[] {
    const out: { file: string; message: string }[] = [];
    for (const file of [...this.files.keys()].sort()) {
      const { parseError } = this.files.get(file)!;
      if (parseError) out.push({ file, message: parseError });
    }
    return out;
  }

  // key → every source file that writes or uses it (translator context)
  origins(): Map<string, string[]> {
    const out = this.usedKeys();
    for (const analysis of this.inOrder()) {
      for (const msg of analysis.tagged) {
        const files = out.get(msg.key) ?? [];
        if (!files.includes(msg.file)) files.push(msg.file);
        out.set(msg.key, files);
      }
    }
    return out;
  }

  // by path: a dev server registers files in load order, and every report must read the same
  private inOrder(): Analysis[] {
    return [...this.files.keys()].sort().map((file) => this.files.get(file)!);
  }
}

function earlier(a: TaggedMessage, b: TaggedMessage): boolean {
  return a.file === b.file ? a.start < b.start : a.file < b.file;
}
