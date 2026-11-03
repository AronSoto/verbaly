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

// /open[\s\S]*?close/g with shapes as alternatives, in one pass: no open after a missing close fits
export function blocks(source: string, shapes: readonly BlockShape[]): Block[] {
  const found: Block[] = [];
  // per shape: its next block at or after `from`, null once it has none left
  const next: Array<Block | null | undefined> = shapes.map(() => undefined);
  let from = 0;
  for (;;) {
    let pick = -1;
    for (let i = 0; i < shapes.length; i += 1) {
      const held = next[i];
      if (held === null) continue;
      if (held === undefined || held.start < from) next[i] = nextBlock(source, shapes[i]!, from);
      const block = next[i];
      if (block && (pick < 0 || block.start < next[pick]!.start)) pick = i;
    }
    if (pick < 0) return found;
    const block = next[pick]!;
    found.push(block);
    from = block.end;
  }
}

function nextBlock(source: string, shape: BlockShape, from: number): Block | null {
  const open = search(source, shape.open, from);
  if (!open) return null;
  const body = shape.openTag ? source.indexOf('>', open[1]) + 1 : open[1];
  if (body === 0) return null;
  const close = search(source, shape.close, body);
  if (!close) return null;
  const end = shape.closeTag ? source.indexOf('>', close[1]) + 1 : close[1];
  if (end === 0) return null;
  return { start: open[0], body, close: close[0], end };
}

// where `what` next matches at or after `from`, and where that match ends
function search(source: string, what: RegExp | string, from: number): [number, number] | null {
  if (typeof what === 'string') {
    const at = source.indexOf(what, from);
    return at < 0 ? null : [at, at + what.length];
  }
  what.lastIndex = from;
  const found = what.exec(source);
  return found ? [found.index, what.lastIndex] : null;
}
