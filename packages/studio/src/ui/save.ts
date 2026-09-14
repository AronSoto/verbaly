import { ask } from './wire';

// The server is the authority: it runs the same two validations check runs before it writes.
export interface Saved {
  locale: string;
  key: string;
  clearedDraft: boolean;
}

export async function saveMessage(
  token: string,
  locale: string,
  key: string,
  text: string,
): Promise<{ saved?: Saved; error?: string }> {
  const path = `/api/message/${encodeURIComponent(locale)}/${encodeURIComponent(key)}`;
  const answer = await ask<Saved>(token, path, { method: 'PUT', body: { text } });
  return answer.error ? { error: answer.error } : { saved: answer.value };
}

export interface ReadResult {
  locale: string;
  approved: number;
  keys: string[];
}

export async function markRead(
  token: string,
  locale: string,
  keys: string[] | undefined,
  undo: boolean,
): Promise<{ done?: ReadResult; error?: string }> {
  const answer = await ask<ReadResult>(token, '/api/approve', {
    method: 'POST',
    body: { locale, keys, undo },
  });
  return answer.error ? { error: answer.error } : { done: answer.value };
}

export interface Check {
  level: 'ok' | 'warn' | 'error';
  check: string;
  message: string;
  fix?: string;
}

export async function fetchHealth(
  token: string,
): Promise<{ ok: boolean; entries: Check[]; error?: string }> {
  const answer = await ask<{ ok: boolean; entries: Check[] }>(token, '/api/health');
  if (answer.error) return { ok: false, entries: [], error: answer.error };
  return { ok: answer.value?.ok ?? false, entries: answer.value?.entries ?? [] };
}
