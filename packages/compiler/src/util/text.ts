// counts read like text, so the tool that translates apps never prints "1 messages"
export function counted(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

// what .replace(/\/+$/, '') returns, read from the end: that regex retries every run of slashes
export function trimTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 47) end -= 1;
  return text.slice(0, end);
}

// a string literal in single quotes, for the code we write where the rest of it uses them
export function singleQuoted(text: string): string {
  return `'${text.replace(/[\\']/g, '\\$&')}'`;
}

// code unit order: localeCompare follows the machine's language, and two machines would disagree
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// a byte order mark is not part of what a file says: every reader of a file drops it first
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
