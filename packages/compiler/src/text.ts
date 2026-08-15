// counts read like text, so the tool that translates apps never prints "1 messages"
export function counted(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}
