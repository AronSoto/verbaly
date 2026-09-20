import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDrafts, resolveConfig } from '@verbaly/compiler';
import { startStudio, type StudioServer } from '../src/server';

let studio: StudioServer;
let root: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'verbaly-studio-http-'));
  const dir = join(root, 'locales');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'en.json'), JSON.stringify({ hello: 'Hello' }, null, 2));
  writeFileSync(join(dir, 'es.json'), JSON.stringify({ hello: 'Hola' }, null, 2));
  writeFileSync(join(dir, '.verbaly-drafts.json'), JSON.stringify({ es: ['hello'] }, null, 2) + '\n');
  const cfg = resolveConfig({ root, dir: 'locales', sourceLocale: 'en', locales: ['en', 'es'] });
  studio = await startStudio(cfg, { port: 0 });
});

afterEach(async () => {
  await studio.close();
  rmSync(root, { recursive: true, force: true });
});

const call = (path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${studio.port}${path}`, {
    ...init,
    headers: { host: `127.0.0.1:${studio.port}`, ...(init.headers ?? {}) },
  });

const withToken = (path: string) =>
  `${path}${path.includes('?') ? '&' : '?'}t=${studio.token}`;

describe('guards', () => {
  it('answers 401 without the token the command printed', async () => {
    expect((await call('/api/state')).status).toBe(401);
  });

  // fetch refuses to set Host (forbidden header), so a rebind has to be sent raw
  it('answers 403 to a foreign Host, which is what a DNS rebind looks like', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: studio.port,
          path: withToken('/api/state'),
          headers: { host: 'evil.example.com' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('answers 403 to a cross origin even with the right token', async () => {
    const res = await call(withToken('/api/state'), {
      headers: { origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});

describe('routes', () => {
  // Proved able to fail by answering 404 like /api/job/:id does: the panel treats that as an error.
  it('says nothing is running rather than failing, so a reload can ask at boot', async () => {
    const response = await call(withToken('/api/job'));

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it('serves the whole project in one shot', async () => {
    const res = await call(withToken('/api/state'));
    expect(res.status).toBe(200);
    const state = (await res.json()) as Record<string, unknown>;
    expect(state.sourceLocale).toBe('en');
    expect(state.locales).toEqual(['en', 'es']);
    expect((state.catalogs as Record<string, unknown>).es).toEqual({ hello: 'Hola' });
    expect(state.drafts).toEqual({ es: ['hello'] });
  });

  it('serves what doctor reports', async () => {
    const res = await call(withToken('/api/health'));
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).entries)).toBe(true);
  });

  it('writes a translation and clears its draft in the same call', async () => {
    const res = await call(withToken('/api/message/es/hello'), {
      method: 'PUT',
      body: JSON.stringify({ text: 'Buenas' }),
    });
    expect(await res.json()).toEqual({ locale: 'es', key: 'hello', clearedDraft: true });
    expect(loadDrafts(resolveConfig({ root, dir: 'locales' }))).toEqual({});
  });

  it('refuses a body without text', async () => {
    const res = await call(withToken('/api/message/es/hello'), { method: 'PUT', body: '{}' });
    expect(res.status).toBe(400);
  });

  it('approves a whole locale', async () => {
    const res = await call(withToken('/api/approve'), {
      method: 'POST',
      body: JSON.stringify({ locale: 'es' }),
    });
    expect(await res.json()).toEqual({ locale: 'es', approved: 1, keys: ['hello'] });
  });

  it('undoes an approval when asked, and refuses to guess what to put back', async () => {
    const approved = await call(withToken('/api/approve'), {
      method: 'POST',
      body: JSON.stringify({ locale: 'es' }),
    });
    expect((await approved.json()).keys).toEqual(['hello']);

    const blind = await call(withToken('/api/approve'), {
      method: 'POST',
      body: JSON.stringify({ locale: 'es', undo: true }),
    });
    expect(blind.status).toBe(400);
    expect((await blind.json()).error).toContain('keys');

    const back = await call(withToken('/api/approve'), {
      method: 'POST',
      body: JSON.stringify({ locale: 'es', keys: ['hello'], undo: true }),
    });
    expect(back.status).toBe(200);
    expect(loadDrafts(resolveConfig({ root, dir: 'locales' }))).toEqual({ es: ['hello'] });
  });

  it('answers 404 naming the route it does not have', async () => {
    const res = await call(withToken('/api/nope'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('/api/nope');
  });

  it('turns a refused write into a 400 with the reason, never a stack trace', async () => {
    const res = await call(withToken('/api/message/en/hello'), {
      method: 'PUT',
      body: JSON.stringify({ text: 'Hi' }),
    });
    expect(res.status).toBe(400);
    const error = (await res.json()).error as string;
    expect(error).toContain('source text lives in your code');
    expect(error).not.toContain('at ');
  });

  // Proved able to fail by moving the URL constructor out of handle()'s try: the process dies.
  it('answers // instead of dying on it, and is still serving afterwards', async () => {
    const res = await call('//');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await call(withToken('/api/state'))).status).toBe(200);
  });

  it('refuses a key whose percent-encoding is broken', async () => {
    const res = await call(withToken('/api/message/es/%E0%A4%A'), {
      method: 'PUT',
      body: JSON.stringify({ text: 'Hola' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('percent-encoding');
  });

  it('refuses a body that is not a JSON object', async () => {
    const res = await call(withToken('/api/message/es/hello'), { method: 'PUT', body: '[]' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('JSON object');
  });

  // A local tool still reads whatever a page on this machine posts at it.
  it('refuses a body over the cap instead of buffering it', async () => {
    const res = await call(withToken('/api/message/es/hello'), {
      method: 'PUT',
      body: JSON.stringify({ text: 'x'.repeat(1_100_000) }),
    });
    expect(res.status).toBe(413);
  });

  // Proved able to fail by sending error.message raw from handle()'s catch.
  it('never puts the absolute path of the project in an answer', async () => {
    writeFileSync(join(root, 'locales', 'es.json'), '{ not json');
    const res = await call(withToken('/api/message/es/hello'), {
      method: 'PUT',
      body: JSON.stringify({ text: 'Buenas' }),
    });
    expect(res.status).toBe(500);
    const error = (await res.json()).error as string;
    expect(error).toContain('es.json');
    expect(error).not.toContain(root);
  });
  // the fixture is a temporary directory with no repository, which is a real project state
  it('answers the row menu about a key, and says so when there is no git to ask', async () => {
    const res = await call(withToken('/api/commit/hello'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ key: 'hello', commit: null, reason: 'nogit' });
  });

  it('reads a key with a dot in it, because that is what a group looks like', async () => {
    const res = await call(withToken('/api/commit/' + encodeURIComponent('nav.docs')));
    expect((await res.json()).key).toBe('nav.docs');
  });
});
