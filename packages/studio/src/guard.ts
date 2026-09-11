import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface GuardOptions {
  port: number;
  token: string;
}

// A local server that writes files is reachable from any page the browser has open.
export function newToken(): string {
  return randomBytes(9).toString('base64url');
}

// Only the two names that resolve to this machine. A DNS rebind arrives with a foreign Host.
export function hostAllowed(host: string | undefined, port: number): boolean {
  // a browser omits the port when it is the scheme default, so :80 would 403 every real request
  const names = port === 80 ? ['127.0.0.1', 'localhost'] : [];
  return [`127.0.0.1:${port}`, `localhost:${port}`, ...names].includes(host ?? '');
}

// No Origin at all is a same-origin navigation or a curl, both fine; a foreign one never is.
export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

// Compared in constant time so the token cannot be guessed one character at a time.
export function tokenMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface GuardVerdict {
  ok: boolean;
  status: number;
  reason: string;
}

const PASS: GuardVerdict = { ok: true, status: 200, reason: '' };

export function guardRequest(
  headers: { host?: string; origin?: string },
  url: URL,
  { port, token }: GuardOptions,
): GuardVerdict {
  if (!hostAllowed(headers.host, port)) {
    return { ok: false, status: 403, reason: '[verbaly] unexpected Host header' };
  }
  if (!originAllowed(headers.origin, port)) {
    return { ok: false, status: 403, reason: '[verbaly] cross-origin request' };
  }
  if (!tokenMatches(url.searchParams.get('t'), token)) {
    return { ok: false, status: 401, reason: '[verbaly] missing or wrong token, open the printed url' };
  }
  return PASS;
}
