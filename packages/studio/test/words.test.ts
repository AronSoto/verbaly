import { describe, expect, it } from 'vitest';
import type { Added } from '../src/ui/api';
import { extractNews } from '../src/ui/words';

const result = (more: Partial<Added> = {}): Added => ({
  added: {},
  found: 0,
  replaced: 0,
  messages: 4,
  ...more,
});

describe('what Find new text says, which is also whether the panel reads the catalogs again', () => {
  it('has no news when the run changed nothing on disk', () => {
    expect(extractNews(result())).toBeUndefined();
  });

  it('counts the messages the code uses and the catalogs did not have', () => {
    expect(extractNews(result({ found: 2 }))).toBe(
      '2 messages your code uses and your catalogs did not have',
    );
  });

  // the catalog changed on disk with nothing new in it: saying "nothing new" left the old text up
  it('has news when the code rewrote a source text and nothing else is new', () => {
    expect(extractNews(result({ replaced: 1 }))).toBe(
      '1 source text now reads as your code writes it',
    );
    expect(extractNews(result({ replaced: 3 }))).toBe(
      '3 source texts now read as your code writes them',
    );
  });

  it('says both when a run found new text and rewrote one', () => {
    expect(extractNews(result({ found: 1, replaced: 2 }))).toBe(
      '1 message your code uses and your catalogs did not have. 2 source texts now read as your code writes them',
    );
  });

  it('never hides a lock it could not write behind good news, or behind none', () => {
    const problem = 'verbaly.lock is not valid JSON';
    expect(extractNews(result({ stateProblem: problem }))).toBe(
      'verbaly.lock is not valid JSON, so drafts are not tracked',
    );
    expect(extractNews(result({ found: 1, stateProblem: problem }))).toBe(
      '1 message your code uses and your catalogs did not have. verbaly.lock is not valid JSON, so drafts are not tracked',
    );
  });
});
