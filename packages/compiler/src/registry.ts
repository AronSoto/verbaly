import type { Analysis, MissedCall, StrayImport, TaggedMessage } from './analyze';

// one key, two texts: the first one wins everywhere, so the others render somebody else's text
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

  // first wins; whoever reports runs collisions(), which knows where both texts were written
  messages(): Map<string, TaggedMessage> {
    const out = new Map<string, TaggedMessage>();
    for (const analysis of this.files.values()) {
      for (const msg of analysis.tagged) {
        if (!out.has(msg.key)) out.set(msg.key, msg);
      }
    }
    return out;
  }

  collisions(): Collision[] {
    const seen = new Map<string, Collision>();
    for (const analysis of this.files.values()) {
      for (const msg of analysis.tagged) {
        const found = seen.get(msg.key);
        if (!found) {
          seen.set(msg.key, { key: msg.key, kept: msg, dropped: [] });
        } else if (
          msg.message !== found.kept.message &&
          !found.dropped.some((other) => other.message === msg.message)
        ) {
          found.dropped.push(msg);
        }
      }
    }
    return [...seen.values()].filter((entry) => entry.dropped.length > 0);
  }

  // strict leaves out the loose spellings, which the gate does not fail on yet
  usedKeys(strict = false): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const analysis of this.files.values()) {
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
    return [...this.files.values()].flatMap((analysis) => analysis.strayImports);
  }

  // a t under another name: its texts are neither extracted nor rewritten, so they never translate
  missed(): MissedCall[] {
    return [...this.files.values()].flatMap((analysis) => analysis.missed ?? []);
  }

  // files the parser could not read: they contributed no messages and nothing else can tell
  parseErrors(): { file: string; message: string }[] {
    const out: { file: string; message: string }[] = [];
    for (const [file, analysis] of this.files) {
      if (analysis.parseError) out.push({ file, message: analysis.parseError });
    }
    return out;
  }

  // key → every source file that writes or uses it (translator context)
  origins(): Map<string, string[]> {
    const out = this.usedKeys();
    for (const analysis of this.files.values()) {
      for (const msg of analysis.tagged) {
        const files = out.get(msg.key) ?? [];
        if (!files.includes(msg.file)) files.push(msg.file);
        out.set(msg.key, files);
      }
    }
    return out;
  }
}
