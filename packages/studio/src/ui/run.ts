import { ask, type Answer } from './wire';
import type { RawState } from './model';

export interface Added {
  added: Record<string, string[]>;
  found: number;
  messages: number;
}

export interface Plan {
  pending: Record<string, string[]>;
  total: number;
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

export function findText(token: string): Promise<Answer<Added>> {
  return ask<Added>(token, '/api/extract', { method: 'POST' });
}

// The plan is the bill: it is a separate route so that seeing the cost never starts the spending.
export function planTranslation(token: string, locales: string[]): Promise<Answer<Plan>> {
  const query = locales.map((locale) => `locale=${encodeURIComponent(locale)}`).join('&');
  return ask<Plan>(token, `/api/translate${query ? `?${query}` : ''}`);
}

export function startTranslation(token: string, locales: string[]): Promise<Answer<Job>> {
  return ask<Job>(token, '/api/translate', { method: 'POST', body: { locales } });
}

// null, not a 404: nothing running is the ordinary answer, and the panel asks it at every boot
export function currentJob(token: string): Promise<Answer<Job | null>> {
  return ask<Job | null>(token, '/api/job');
}

export function readJob(token: string, id: string): Promise<Answer<Job>> {
  return ask<Job>(token, `/api/job/${encodeURIComponent(id)}`);
}

// A command rewrites the catalogs on disk, so the panel re-reads them all instead of guessing.
export function fetchState(token: string): Promise<Answer<RawState>> {
  return ask<RawState>(token, '/api/state');
}
