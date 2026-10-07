/**
 * Test helpers for the Gymme API.
 *
 * `server.js` reads its configuration from the environment when it is first imported, so a
 * test file calls {@link startTestServer} once (each file runs in its own process under
 * `node --test`) and gets a real HTTP server bound to an ephemeral port with a throw-away
 * data directory. Nothing here touches WebAuthn: users are written straight into the
 * identity store and authenticated with a cookie minted by the production signer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Db, User } from '../types.ts';

/** A user created by {@link TestServer.createUser}. */
export interface TestUser {
  /** Identity-store id of the user. */
  id: string
  /** Display name stored on the user record. */
  name: string
  /** Ready-to-send `Cookie` header value for this user. */
  cookie: string
}

export interface RequestOptions {
  /** HTTP verb, defaults to `GET`. */
  method?: string
  /** JSON body, serialised for you. */
  body?: unknown
  /** User to authenticate as; anonymous when omitted. */
  as?: TestUser
  /** Client address, sent as `X-Real-IP` the way the bundled nginx does. */
  ip?: string
}

/** A response of {@link TestServer.request}; `body` is the parsed JSON, or null when there is none. */
export interface TestResponse {
  status: number
  // any: tests read arbitrary fields of whatever the route answered, and assert on them right after
  body: any
  headers: Headers
}

export interface TestServer {
  /** Origin of the running server, e.g. `http://127.0.0.1:41233`. */
  baseUrl: string
  /** Temporary data directory used by this instance. */
  dataDir: string
  /** Adds a user and returns its session cookie. */
  createUser: (name?: string, extra?: Partial<User>) => TestUser
  /** JSON request helper. */
  request: (pathname: string, opts?: RequestOptions) => Promise<TestResponse>
  /** Stops the server and deletes the data directory. */
  close: () => Promise<void>
}

/** The parts of `server.js` the helpers use; replaced by the real types when the server is converted. */
interface ServerModule {
  server: Server
  db: Db
  saveDb: () => void
  sessionCookie: (user: User) => string
}

/**
 * Boots the API on an ephemeral port with an isolated data directory.
 *
 * @param env  Extra environment variables applied before the server is imported
 *   (for example `{ SOCIAL_ENABLED: '0' }`).
 */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gymme-api-test-'));
  Object.assign(process.env, { DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' }, env);

  const mod = (await import('../server.js')) as unknown as ServerModule;
  await new Promise<void>(resolve => mod.server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(mod.server.address() as AddressInfo).port}`;

  let counter = 0;
  const createUser = (name = `user${++counter}`, extra: Partial<User> = {}): TestUser => {
    const user: User = { id: `test${String(++counter).padStart(4, '0')}`, name, created: new Date().toISOString(), ...extra };
    mod.db.users.push(user);
    mod.saveDb();
    return { id: user.id, name, cookie: mod.sessionCookie(user).split(';')[0] };
  };

  // Each test user gets an address of their own unless a test says otherwise, so the per-address
  // rate limits of the social routes never make unrelated tests interfere with each other.
  const addresses = new Map<string, string>();
  const addressOf = (user: TestUser): string => {
    if (!addresses.has(user.id)) { const n = addresses.size + 1; addresses.set(user.id, `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`); }
    return addresses.get(user.id)!;
  };

  const request = async (pathname: string, { method = 'GET', body, as, ip }: RequestOptions = {}): Promise<TestResponse> => {
    ip ??= as ? addressOf(as) : undefined;
    const res = await fetch(baseUrl + pathname, {
      method,
      headers: { 'Content-Type': 'application/json', ...(as ? { Cookie: as.cookie } : {}), ...(ip ? { 'X-Real-IP': ip } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };

  const close = async () => {
    await new Promise(resolve => mod.server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, dataDir, createUser, request, close };
}

/**
 * Every social route, as `[method, path]`. The authorization matrix and the "module disabled"
 * test both walk this list, and a test fails when it differs from the routes the server registers,
 * so a new route cannot ship without being covered.
 *
 */
export const SOCIAL_ROUTES: Array<[string, string]> = [
  ['GET', '/api/social/me'], ['PUT', '/api/social/me'], ['POST', '/api/social/leave'],
  ['POST', '/api/social/friends/code'], ['GET', '/api/social/friends'], ['POST', '/api/social/friends/request'],
  ['POST', '/api/social/friends/respond'], ['POST', '/api/social/friends/remove'], ['POST', '/api/social/friends/block'],
  ['POST', '/api/social/friends/unblock'], ['GET', '/api/social/friends/summary'],
  ['GET', '/api/social/challenges'], ['GET', '/api/social/challenge'], ['POST', '/api/social/challenges'],
  ['POST', '/api/social/challenges/join'], ['POST', '/api/social/challenges/leave'], ['POST', '/api/social/challenges/cancel'],
  ['GET', '/api/social/feed'], ['POST', '/api/social/cheer'], ['POST', '/api/social/cheer/retract'], ['POST', '/api/social/cheer/mute']
];
