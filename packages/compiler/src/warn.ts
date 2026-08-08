const warned = new Set<string>();

// bundler paths only: the CLI reports its own run, so a file is never announced twice
export function warnParseError(file: string, message: string): void {
  const line = `[verbaly] ${file}: could not be parsed (${message}), its messages were not extracted`;
  if (warned.has(line)) return;
  warned.add(line);
  console.warn(line);
}
