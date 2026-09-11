import { describe, expect, it } from 'vitest';
import { guardRequest, hostAllowed, newToken, originAllowed, tokenMatches } from '../src/guard';

const PORT = 4747;
const url = (query = '') => new URL(`http://127.0.0.1:${PORT}/api/state${query}`);

describe('hostAllowed', () => {
  it('takes only the two names that resolve to this machine', () => {
    expect(hostAllowed('127.0.0.1:4747', PORT)).toBe(true);
    expect(hostAllowed('localhost:4747', PORT)).toBe(true);
    expect(hostAllowed('evil.example.com:4747', PORT)).toBe(false);
    expect(hostAllowed(undefined, PORT)).toBe(false);
  });
});

describe('originAllowed', () => {
  it('lets a request with no Origin through, and never a foreign one', () => {
    expect(originAllowed(undefined, PORT)).toBe(true);
    expect(originAllowed('http://localhost:4747', PORT)).toBe(true);
    expect(originAllowed('https://evil.example.com', PORT)).toBe(false);
  });
});

describe('tokenMatches', () => {
  it('rejects a missing token and a wrong one of the same length', () => {
    expect(tokenMatches(null, 'abcdefgh')).toBe(false);
    expect(tokenMatches('abcdefgh', 'abcdefgh')).toBe(true);
    expect(tokenMatches('abcdefgi', 'abcdefgh')).toBe(false);
    expect(tokenMatches('abc', 'abcdefgh')).toBe(false);
  });
});

describe('guardRequest', () => {
  const token = 'tok3nvalue';
  const ok = { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}` };

  it('passes a same-origin request carrying the token', () => {
    expect(guardRequest(ok, url(`?t=${token}`), { port: PORT, token }).ok).toBe(true);
  });

  it('blocks a rebound Host before anything else', () => {
    const verdict = guardRequest({ host: 'evil.example.com' }, url(`?t=${token}`), {
      port: PORT,
      token,
    });
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  it('blocks a cross origin even with the right token', () => {
    const verdict = guardRequest(
      { ...ok, origin: 'https://evil.example.com' },
      url(`?t=${token}`),
      { port: PORT, token },
    );
    expect(verdict).toMatchObject({ ok: false, status: 403 });
  });

  it('blocks a same-origin request with no token', () => {
    expect(guardRequest(ok, url(), { port: PORT, token })).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

describe('newToken', () => {
  it('mints a different token per boot', () => {
    expect(newToken()).not.toBe(newToken());
  });
});

describe('the scheme-default port', () => {
// Proved able to fail by demanding the port unconditionally: every browser request 403s on :80.
it('accepts a Host with no port when the port is the scheme default', () => {
  expect(hostAllowed('127.0.0.1', 80)).toBe(true);
  expect(hostAllowed('localhost', 80)).toBe(true);
  expect(hostAllowed('127.0.0.1', 4747)).toBe(false);
  expect(hostAllowed('evil.example.com', 80)).toBe(false);
});
});
