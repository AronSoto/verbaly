import type { MessageState } from './model';

// The words are a product decision: each names a checkable fact, never a stage of a workflow.
export const STATE: Record<MessageState, { short: string; long: string }> = {
  done: { short: 'ready', long: 'ready' },
  draft: { short: 'unread', long: 'written by a machine, nobody has read it' },
  missing: { short: 'missing', long: 'missing, so your visitor sees the source language' },
  broken: { short: 'breaks', long: 'breaks your site' },
};

export const FILTER: Record<'all' | 'look' | 'missing' | 'draft' | 'broken', string> = {
  all: 'everything',
  missing: 'missing',
  draft: 'unread',
  broken: 'breaks your site',
  look: 'worth a look',
};

// The signals do not score a translation, they point at the few worth reading first.
export const SIGNAL: Record<string, string> = {
  divergent: 'the source says this two ways',
  collision: 'came back as two translations',
  echo: 'still identical to the source',
  digits: 'the numbers moved',
  url: 'a link changed',
  code: 'a code span changed',
};

export const MARK_AS_READ = 'Mark as read';
export const UNDO = 'Undo';

// The two commands the panel can run, named by what they leave behind, not by what they are called.
export const ACTION = {
  find: 'Find new text',
  findWhy: 'Reads your code and adds what your catalogs do not have yet.',
  translate: 'Translate what is missing',
  translateWhy: 'Calls your provider, so it costs money and takes minutes.',
  cancel: 'Not now',
  working: 'Reading your code',
  running: 'Translating',
  nothingNew: 'Nothing new: your catalogs already have every message your code uses.',
  nothingMissing: 'Nothing missing in the languages you ticked.',
  pickFirst: 'Tick a language to translate it.',
} as const;

export function messages(n: number): string {
  return `${n} ${n === 1 ? 'message' : 'messages'}`;
}
