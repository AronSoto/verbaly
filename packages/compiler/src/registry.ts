import type { Analysis, TaggedMessage } from './analyze';

export class MessageRegistry {
  private files = new Map<string, Analysis>();

  update(file: string, analysis: Analysis): void {
    this.files.set(file, analysis);
  }

  remove(file: string): void {
    this.files.delete(file);
  }

  messages(): Map<string, TaggedMessage> {
    const out = new Map<string, TaggedMessage>();
    for (const analysis of this.files.values()) {
      for (const msg of analysis.tagged) {
        const existing = out.get(msg.key);
        if (existing) {
          if (existing.message !== msg.message) {
            console.warn(
              `[verbaly] key collision "${msg.key}": ` +
                `${JSON.stringify(existing.message)} vs ${JSON.stringify(msg.message)}, second dropped.`,
            );
          }
          continue;
        }
        out.set(msg.key, msg);
      }
    }
    return out;
  }

  usedKeys(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const analysis of this.files.values()) {
      for (const used of analysis.usedKeys) {
        const files = out.get(used.key) ?? [];
        if (!files.includes(used.file)) files.push(used.file);
        out.set(used.key, files);
      }
    }
    return out;
  }
}
