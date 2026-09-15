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

// The group is the first segment of the key, which is the only one the catalog really declares.
export const GROUP = {
  cap: 'Group',
  all: 'every group',
  none: 'Your keys have no groups yet.',
  hint: 'A key like nav.home belongs to nav.',
} as const;

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
  onlyLocale: 'This project has one language, so there is nothing to translate into.',
  scanOff: 'Source scanning is off in your config, so there is nothing to read.',
} as const;

// An empty screen that tells you to click something that is not there is worse than a blank one.
export const EMPTY = {
  noCatalogs: 'No messages yet. Studio reads the catalogs in your project, and there are none here.',
  oneLocale: 'One language is all you have, so there is nothing to compare it against yet.',
  oneLocaleFix: 'Add another one to your config and it shows up in the rail.',
  pickOne: 'Tick a language in the rail to see its translations.',
  noMatch: 'Nothing matches. Every message here is in the state you asked for.',
} as const;

export function messages(n: number): string {
  return `${n} ${n === 1 ? 'message' : 'messages'}`;
}

// The first screen names what is waiting, in the order you would want to deal with it.
export const WAITING = {
  broken: { one: 'translation breaks your site', many: 'translations break your site' },
  missing: { one: 'message is missing', many: 'messages are missing' },
  draft: { one: 'translation nobody has read', many: 'translations nobody has read' },
  undefined: { one: 'key your code calls has no message', many: 'keys your code calls have no message' },
} as const;

export const WHY: Record<keyof typeof WAITING, string> = {
  broken: 'It lost a parameter or a tag, so the sentence would ship incomplete.',
  missing: 'Your visitor sees the source language until one is written.',
  draft: 'A machine wrote it and nobody has looked. It is already on your site.',
  undefined: 'Nothing defines it, so the build fails and the raw key would reach your page.',
};

export const OVERVIEW = {
  here: 'Overview',
  clear: 'Nothing is waiting for you.',
  clearWhy: 'Every language is complete and the build passes.',
  project: 'Project',
  healthy: 'Healthy',
  problems: 'Needs a look',
  checks: 'checks',
  history: 'Last changes to your catalogs',
  noHistory: 'No git history for your catalog directory.',
  countMessages: 'Messages',
  countLocales: 'Languages',
  open: 'Open',
} as const;

// Searching is the one place the panel reads languages you did not tick, so it says so.
export const SEARCH = {
  label: 'Search your messages',
  scope: 'Searches your text in every language, never the key.',
  none: 'Nothing has that text, in any language.',
  oneHit: '1 message',
  hits: (n: number) => `${n} messages`,
  moveKeys: 'move',
  openKeys: 'open',
  closeKeys: 'close',
  close: 'Close',
  placeholder: 'Search the text, not the key',
} as const;
