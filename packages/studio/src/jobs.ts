import { badRequest, HttpError } from './http';

export type JobState = 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  kind: 'translate';
  state: JobState;
  total: number;
  done: number;
  locale?: string;
  message?: string;
  result?: unknown;
}

// One at a time, because two runs over the same catalogs is a race over the same files.
let current: Job | null = null;
let counter = 0;

export function running(): Job | null {
  return current?.state === 'running' ? current : null;
}

export function read(id: string): Job {
  if (!current || current.id !== id) throw new HttpError(404, `no job called "${id}"`);
  return current;
}

export function start(kind: Job['kind'], total: number): Job {
  if (running()) throw badRequest('a job is already running, wait for it or read its progress');
  counter += 1;
  current = { id: `${kind}-${counter}`, kind, state: 'running', total, done: 0 };
  return current;
}

// A batch that failed still finishes: the bar reports work attempted, and message says what broke.
export function advance(id: string, keys: number, locale: string, error?: string): void {
  if (current?.id !== id) return;
  current.done = Math.min(current.done + keys, current.total);
  current.locale = locale;
  if (error) current.message = error;
}

// A run that writes part of its work and then fails is a success for what it wrote, so both land.
export function finish(id: string, state: 'done' | 'failed', patch: Partial<Job> = {}): void {
  if (current?.id === id) Object.assign(current, patch, { state });
}
