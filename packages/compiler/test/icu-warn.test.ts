import { describe, expect, it, vi } from 'vitest';
import { validateMessage, validatePair } from '../src/validate';

// alone in its file: warnOnce is module state, so an earlier ICU message eats the one call
describe('the gate never blames the app for a parser it was not passing', () => {
  // Proved able to fail by dropping parseIcu from validate.ts: the warn fires once.
  it('reads an ICU message without warning that createVerbaly needs an icu option', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateMessage('{visits, plural, one {# visit} other {# visits}}', 'en');
    validatePair('{likes, plural, one {# like} other {# likes}}', '{likes, plural, other {#}}');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
