// one warn-once for the whole runtime: the set is unbounded, so a message never carries a value
const warned = new Set<string>();

export function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[verbaly] ${message}`);
}
