import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;

before(async () => { app = await startTestServer(); });
after(async () => { await app.close(); });

test('GET /api/config advertises that the social module is on', async () => {
  const { body } = await app.request('/api/config');
  assert.equal(body.social_enabled, true);
});

test('social settings require a session', async () => {
  assert.equal((await app.request('/api/social/me')).status, 401);
  assert.equal((await app.request('/api/social/me', { method: 'PUT', body: {} })).status, 401);
});

test('a user who never touched the module is private by default', async () => {
  const user = app.createUser('fresh');
  const { status, body } = await app.request('/api/social/me', { as: user });
  assert.equal(status, 200);
  assert.equal(body.social.enabled, false);
  assert.equal(body.social.handle, '');
  assert.equal(body.social.share.prs, false);
});

test('PUT /api/social/me stores validated settings and GET reads them back', async () => {
  const user = app.createUser('lea');
  const put = await app.request('/api/social/me', {
    method: 'PUT', as: user,
    body: { enabled: true, handle: 'Lea_Fit', displayName: 'Léa', share: { prs: true }, hideRank: true }
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.social.handle, 'lea_fit');

  const get = await app.request('/api/social/me', { as: user });
  assert.deepEqual(get.body.social, {
    enabled: true, handle: 'lea_fit', displayName: 'Léa',
    share: { sessions: true, streak: true, consistency: true, prs: true }, hideRank: true
  });
});

test('settings are per user', async () => {
  const a = app.createUser('a');
  const b = app.createUser('b');
  await app.request('/api/social/me', { method: 'PUT', as: a, body: { handle: 'only_a' } });
  assert.equal((await app.request('/api/social/me', { as: b })).body.social.handle, '');
});

test('two users cannot claim the same handle (case-insensitive)', async () => {
  const a = app.createUser('a2');
  const b = app.createUser('b2');
  assert.equal((await app.request('/api/social/me', { method: 'PUT', as: a, body: { handle: 'shared_one' } })).status, 200);
  const clash = await app.request('/api/social/me', { method: 'PUT', as: b, body: { handle: 'SHARED_ONE' } });
  assert.equal(clash.status, 409);
});

test('invalid payloads answer 400 and change nothing', async () => {
  const user = app.createUser('bad');
  const r = await app.request('/api/social/me', { method: 'PUT', as: user, body: { handle: 'x' } });
  assert.equal(r.status, 400);
  assert.equal((await app.request('/api/social/me', { as: user })).body.social.handle, '');
});

test('sharing can be disabled again and the choice is persisted', async () => {
  const user = app.createUser('toggle');
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle: 'toggle_me', displayName: 'T' } });
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: false } });
  assert.equal((await app.request('/api/social/me', { as: user })).body.social.enabled, false);
});

test('a user who never opens the module keeps a state file free of social fields', async () => {
  const user = app.createUser('plain');
  await app.request('/api/data', { method: 'PUT', as: user, body: { state: { unit: 'kg' } } });
  const { body } = await app.request('/api/data', { as: user });
  assert.deepEqual(body.state, { unit: 'kg' });
});
