import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, SOCIAL_ROUTES } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;

before(async () => { app = await startTestServer({ SOCIAL_ENABLED: '0' }); });
after(async () => { await app.close(); });

test('GET /api/config reports the module as off', async () => {
  const { body } = await app.request('/api/config');
  assert.equal(body.social_enabled, false);
});

test('every social route answers 404 when the instance disabled the module', async () => {
  const user = app.createUser('anyone');
  for (const [method, path] of SOCIAL_ROUTES) {
    const r = await app.request(path, { method, as: user, body: method === 'GET' ? undefined : {} });
    assert.equal(r.status, 404, `${method} ${path}`);
  }
});

test('no social route is registered at all', async () => {
  const mod = await import('../server.js');
  assert.deepEqual(mod.socialRouteKeys(), []);
});
