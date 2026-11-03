const warned = new Set<string>();

// one warn-once for the whole compiler: dedupe by static content, never by a value being edited
export function warnOnce(message: string, dedupeKey = message): void {
  if (warned.has(dedupeKey)) return;
  warned.add(dedupeKey);
  console.warn(`[verbaly] ${message}`);
}

// bundler paths only: the CLI reports its own run, so a file is never announced twice
export function warnParseError(file: string, message: string): void {
  warnOnce(`${file}: could not be parsed (${message}), its messages were not extracted`);
}
