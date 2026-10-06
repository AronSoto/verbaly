import { readFileSync } from 'node:fs';

export function lineAt(content: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, content.length);
  for (let i = 0; i < end; i++) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

// one read per file however many entries point into it; a file gone since the scan has no line
export function createLocator(): (file: string, offset: number) => number | undefined {
  const contents = new Map<string, string | undefined>();
  return (file, offset) => {
    if (!contents.has(file)) {
      try {
        contents.set(file, readFileSync(file, 'utf8'));
      } catch {
        contents.set(file, undefined);
      }
    }
    const content = contents.get(file);
    return content === undefined ? undefined : lineAt(content, offset);
  };
}
