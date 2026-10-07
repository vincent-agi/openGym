import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

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
  assert.equal((await app.request('/api/social/me', { as: user })).status, 404);
  assert.equal((await app.request('/api/social/me', { method: 'PUT', as: user, body: {} })).status, 404);
});
