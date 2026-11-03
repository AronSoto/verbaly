// a file checked out with CRLF stays CRLF: rewriting every line is a diff nobody made
export function withLineEndings(text: string, existing: string | undefined): string {
  const first = existing?.indexOf('\n') ?? -1;
  return first > 0 && existing![first - 1] === '\r' ? text.replace(/\r?\n/g, '\r\n') : text;
}
