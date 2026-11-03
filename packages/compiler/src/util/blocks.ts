// offsets into the source: [start, end) is the whole block, [body, close) what it holds
export interface Block {
  start: number;
  body: number;
  close: number;
  end: number;
}

export interface BlockShape {
  // a fixed text, or a global regex that matches one length wherever it matches
  open: RegExp | string;
  close: RegExp | string;
  // the open, or the close, runs on to the first > after it, the way [^>]*> reads
  openTag?: boolean;
  closeTag?: boolean;
}

type Span = [start: number, end: number];

// /open[\s\S]*?close/g with shapes as alternatives, in one pass: no open after a missing close fits
export function blocks(source: string, shapes: readonly BlockShape[]): Block[] {
  const found: Block[] = [];
  // per shape: its next open at or after `from`, null once no block of that shape is left
  const opens: Array<Span | null | undefined> = shapes.map(() => undefined);
  let from = 0;
  for (;;) {
    let pick = -1;
    for (let i = 0; i < shapes.length; i += 1) {
      if (opens[i] === null) continue;
      if (opens[i] === undefined || opens[i]![0] < from) {
        opens[i] = search(source, shapes[i]!.open, from);
      }
      if (opens[i] && (pick < 0 || opens[i]![0] < opens[pick]![0])) pick = i;
    }
    if (pick < 0) return found;
    // only the earliest open looks for its close: a later one may sit inside this block
    const block = closed(source, shapes[pick]!, opens[pick]!);
    if (block) {
      found.push(block);
      from = block.end;
    } else {
      opens[pick] = null;
    }
  }
}

function closed(source: string, shape: BlockShape, [start, openEnd]: Span): Block | null {
  const body = shape.openTag ? source.indexOf('>', openEnd) + 1 : openEnd;
  if (body === 0) return null;
  const close = search(source, shape.close, body);
  if (!close) return null;
  const end = shape.closeTag ? source.indexOf('>', close[1]) + 1 : close[1];
  if (end === 0) return null;
  return { start, body, close: close[0], end };
}

// where `what` next matches at or after `from`, and where that match ends
function search(source: string, what: RegExp | string, from: number): Span | null {
  if (typeof what === 'string') {
    const at = source.indexOf(what, from);
    return at < 0 ? null : [at, at + what.length];
  }
  what.lastIndex = from;
  const found = what.exec(source);
  return found ? [found.index, what.lastIndex] : null;
}
