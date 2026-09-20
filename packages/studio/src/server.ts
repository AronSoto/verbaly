import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResolvedConfig } from '@verbaly/compiler';
import { approve, buildState, health, unapprove, writeMessage } from './api';
import { planTranslate, runExtract, startTranslate } from './actions';
import { read as readJob, running } from './jobs';
import { catalogHistory, keyCommit } from './history';
import { readAsset, uiBuilt } from './assets';
import { guardRequest, newToken } from './guard';
import { HttpError, badRequest, scrub } from './http';

export interface StudioServer {
  server: Server;
  port: number;
  token: string;
  url: string;
  close: () => Promise<void>;
}

export interface StartOptions {
  port?: number;
  token?: string;
}

const DEFAULT_PORT = 4747;
const MAX_BODY = 1_000_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw badRequest('body is not valid JSON');
  }
  // null and an array both pass typeof 'object', and reading .text off them is a 500
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function segment(raw: string | undefined, what: string): string {
  let value: string;
  try {
    value = decodeURIComponent(raw ?? '');
  } catch {
    throw badRequest(`the ${what} in the url is not valid percent-encoding`);
  }
  if (!value) throw badRequest(`the url is missing a ${what}`);
  return value;
}

// One page, JSON on every route: a framework would only add a dependency to a local tool.
export function createStudioApp(cfg: ResolvedConfig, port: number, token: string) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // The url is built inside the try: `GET //` throws, and out here that would kill the process.
    try {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      } catch {
        throw badRequest('the request target is not a valid url');
      }

      const api = url.pathname.startsWith('/api/');
      const verdict = guardRequest({ host: req.headers.host, origin: req.headers.origin }, url, {
        port,
        token,
      });
      // the panel files are the published npm package: only the project data needs a token
      if (!verdict.ok && (api || verdict.status !== 401)) {
        send(res, verdict.status, { error: verdict.reason });
        return;
      }

      if (!api && req.method === 'GET') {
        const asset = readAsset(url.pathname);
        if (asset) {
          res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
          res.end(asset.body);
          return;
        }
        if (url.pathname === '/' && !uiBuilt()) {
          throw new HttpError(500, 'the panel is not in this install, so only /api/* answers here');
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/state') {
        send(res, 200, await buildState(cfg));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        send(res, 200, { commits: await catalogHistory(cfg) });
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/commit/')) {
        const key = segment(url.pathname.slice('/api/commit/'.length), 'key');
        send(res, 200, await keyCommit(cfg, key));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(res, 200, await health(cfg));
        return;
      }
      if (req.method === 'PUT' && url.pathname.startsWith('/api/message/')) {
        const rest = url.pathname.slice('/api/message/'.length).split('/');
        const locale = segment(rest[0], 'locale');
        const key = segment(rest.slice(1).join('/'), 'key');
        const body = await readJson(req);
        if (typeof body.text !== 'string') throw badRequest('body needs a "text" string');
        send(res, 200, writeMessage(cfg, locale, key, body.text));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/approve') {
        const body = await readJson(req);
        if (typeof body.locale !== 'string') throw badRequest('body needs a "locale" string');
        const keys = Array.isArray(body.keys)
          ? body.keys.filter((k): k is string => typeof k === 'string')
          : undefined;
        if (body.undo === true) {
          if (!keys?.length) throw badRequest('undoing needs the "keys" it should put back');
          send(res, 200, unapprove(cfg, body.locale, keys));
          return;
        }
        send(res, 200, approve(cfg, body.locale, keys));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/extract') {
        send(res, 200, await runExtract(cfg));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/translate') {
        const locales = url.searchParams.getAll('locale');
        send(res, 200, await planTranslate(cfg, locales.length ? locales : undefined));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/translate') {
        const body = await readJson(req);
        const locales = Array.isArray(body.locales)
          ? body.locales.filter((l): l is string => typeof l === 'string')
          : undefined;
        send(res, 200, await startTranslate(cfg, locales?.length ? locales : undefined));
        return;
      }
      // a reload loses the id, so the panel asks what is running rather than losing the bar
      if (req.method === 'GET' && url.pathname === '/api/job') {
        send(res, 200, running());
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/job/')) {
        send(res, 200, readJob(segment(url.pathname.slice('/api/job/'.length), 'job id')));
        return;
      }

      send(res, 404, { error: `[verbaly] no route for ${req.method} ${url.pathname}` });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : String(error);
      send(res, status, { error: scrub(message, cfg.root) });
    }
  };
}

// A busy port climbs instead of failing: this is a local tool, not a service on a fixed address.
function listen(server: Server, port: number, attemptsLeft: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
        server.removeListener('error', onError);
        resolve(listen(server, port + 1, attemptsLeft - 1));
        return;
      }
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      // port 0 asks the system to pick, so the bound address is the only place the answer is
      const bound = server.address() as AddressInfo | string | null;
      resolve(typeof bound === 'object' && bound !== null ? bound.port : port);
    });
  });
}

export async function startStudio(
  cfg: ResolvedConfig,
  options: StartOptions = {},
): Promise<StudioServer> {
  const token = options.token ?? newToken();
  const server = createServer();
  // The handler is attached before listen so no request can arrive without one.
  let port = options.port ?? DEFAULT_PORT;
  server.on('request', (req, res) => void createStudioApp(cfg, port, token)(req, res));
  port = await listen(server, port, 20);

  return {
    server,
    port,
    token,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
