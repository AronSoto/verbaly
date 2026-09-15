import { ask, type Answer } from './wire';
import type { RawState } from './model';

// Everything the panel can ask for, as one object it is handed rather than one it imports.
export interface Saved {
  locale: string;
  key: string;
  clearedDraft: boolean;
}

export interface ReadResult {
  locale: string;
  approved: number;
  keys: string[];
}

export interface Check {
  level: 'ok' | 'warn' | 'error';
  check: string;
  message: string;
  fix?: string;
}

export interface Health {
  ok: boolean;
  entries: Check[];
}

export interface Added {
  added: Record<string, string[]>;
  found: number;
  messages: number;
}

export interface Plan {
  pending: Record<string, string[]>;
  total: number;
}

export interface Commit {
  sha: string;
  author: string;
  date: string;
  subject: string;
}

export interface Job {
  id: string;
  kind: 'translate';
  state: 'running' | 'done' | 'failed';
  total: number;
  done: number;
  locale?: string;
  message?: string;
}

export interface StudioApi {
  state(): Promise<Answer<RawState>>;
  health(): Promise<Answer<Health>>;
  history(): Promise<Answer<{ commits: Commit[] }>>;
  save(locale: string, key: string, text: string): Promise<Answer<Saved>>;
  setRead(locale: string, keys: string[] | undefined, undo: boolean): Promise<Answer<ReadResult>>;
  extract(): Promise<Answer<Added>>;
  // the plan is its own call so that seeing the cost can never start the spending
  plan(locales: string[]): Promise<Answer<Plan>>;
  translate(locales: string[]): Promise<Answer<Job>>;
  job(id?: string): Promise<Answer<Job | null>>;
}

export function serverApi(token: string): StudioApi {
  return {
    state: () => ask<RawState>(token, '/api/state'),
    health: () => ask<Health>(token, '/api/health'),
    history: () => ask<{ commits: Commit[] }>(token, '/api/history'),
    save: (locale, key, text) =>
      ask<Saved>(token, `/api/message/${encodeURIComponent(locale)}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { text },
      }),
    setRead: (locale, keys, undo) =>
      ask<ReadResult>(token, '/api/approve', { method: 'POST', body: { locale, keys, undo } }),
    extract: () => ask<Added>(token, '/api/extract', { method: 'POST' }),
    plan: (locales) => {
      const query = locales.map((locale) => `locale=${encodeURIComponent(locale)}`).join('&');
      return ask<Plan>(token, `/api/translate${query ? `?${query}` : ''}`);
    },
    translate: (locales) => ask<Job>(token, '/api/translate', { method: 'POST', body: { locales } }),
    // without an id it asks what is running, which is how a reloaded page finds its bar again
    job: (id) => ask<Job | null>(token, id ? `/api/job/${encodeURIComponent(id)}` : '/api/job'),
  };
}
