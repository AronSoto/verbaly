import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// render, the gate and XLIFF read a <br> alike only while their three copies of the list agree
const COPIES = {
  core: new URL('../../core/src/tags.ts', import.meta.url),
  gate: new URL('../src/gate/validate.ts', import.meta.url),
  xliff: new URL('../src/exchange/inline.ts', import.meta.url),
};

function breakList(file: URL): string | undefined {
  return /^const BREAK = (\/.+\/);$/m.exec(readFileSync(file, 'utf8'))?.[1];
}

describe('the tags that are a break whatever their spelling', () => {
  it('are the same list in the core, the gate and the XLIFF writer (0.79.0)', () => {
    const core = breakList(COPIES.core);
    expect(core).toBeDefined();
    expect(breakList(COPIES.gate)).toBe(core);
    expect(breakList(COPIES.xliff)).toBe(core);
  });
});
