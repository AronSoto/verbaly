import { describe, expect, it } from 'vitest';
import { bindDom, createVerbaly, flatten, parse } from '../src/index';

describe('public API', () => {
  it('exports the runtime surface', () => {
    expect(createVerbaly).toBeTypeOf('function');
    expect(bindDom).toBeTypeOf('function');
    expect(parse).toBeTypeOf('function');
    expect(flatten).toBeTypeOf('function');
  });
});
