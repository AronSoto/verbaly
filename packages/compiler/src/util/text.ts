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

// code unit order: localeCompare follows the machine's language, and two machines would disagree
export function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
