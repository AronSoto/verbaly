import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server', () => ({
  createVerbalyMcp: () => {
    throw new Error('[verbaly] no catalog folder at ./locales');
  },
}));

describe('the stdio bin', () => {
  // the compiler's errors already open with [verbaly]: the bin used to put its own name before it
  it('prints a failure once prefixed and exits 1', async () => {
    const argv = process.argv;
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    process.argv = [argv[0]!, 'verbaly-mcp'];
    try {
      await import('../src/cli');
      expect(lines).toEqual(['[verbaly] no catalog folder at ./locales']);
      expect(process.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
      process.argv = argv;
      process.exitCode = undefined;
    }
  });
});
