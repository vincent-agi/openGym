import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;

before(async () => { app = await startTestServer(); });
after(async () => { await app.close(); });

test('GET /api/health reports the instance is up', async () => {
  const { status, body } = await app.request('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('unknown routes answer 404 with a JSON error', async () => {
  const { status, body } = await app.request('/api/nope');
  assert.equal(status, 404);
  assert.equal(body.error, 'not found');
});

test('GET /api/data requires a session', async () => {
  const { status } = await app.request('/api/data');
  assert.equal(status, 401);
});

test('a tampered session cookie is rejected', async () => {
  const user = app.createUser('mallory');
  const forged = { ...user, cookie: user.cookie.slice(0, -2) + 'xx' };
  const { status } = await app.request('/api/data', { as: forged });
  assert.equal(status, 401);
});

test('PUT /api/data then GET /api/data round-trips the state and drops the in-progress workout', async () => {
  const user = app.createUser('lea');
  const state = { unit: 'kg', workouts: [{ d: '2026-10-05' }], active: { routineId: 'r1' } };

  const put = await app.request('/api/data', { method: 'PUT', as: user, body: { state } });
  assert.equal(put.status, 200);

  const get = await app.request('/api/data', { as: user });
  assert.equal(get.status, 200);
  assert.deepEqual(get.body.state, { unit: 'kg', workouts: [{ d: '2026-10-05' }] });
});

test('each user only ever reads their own state', async () => {
  const a = app.createUser('a');
  const b = app.createUser('b');
  await app.request('/api/data', { method: 'PUT', as: a, body: { state: { secret: 'a-only' } } });

  const { body } = await app.request('/api/data', { as: b });
  assert.equal(body.state, null);
});

test('a disabled account is locked out', async () => {
  const user = app.createUser('sam', { disabled: true });
  const { status } = await app.request('/api/data', { as: user });
  assert.equal(status, 401);
});
