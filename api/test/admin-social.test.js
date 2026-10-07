import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let seq = 0;

before(async () => { app = await startTestServer(); });
after(async () => { await app.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const session = (d = today()) => ({ id: 'w' + d, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const post = (path, as, body) => app.request('/api/social/' + path, { method: 'POST', as, body });

async function person(label) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle, displayName: label } });
  return { ...user, handle };
}
async function friends(a, b) {
  await post('friends/request', a, { handle: b.handle });
  await post('friends/respond', b, { handle: a.handle, action: 'accept' });
}

test('an admin sees friend and challenge counts per user, never who or what', async () => {
  const admin = app.createUser('boss', { admin: true });
  const a = await person('cnt_a'), b = await person('cnt_b');
  await friends(a, b);
  await post('challenges', a, { title: 'Secret plan', type: 'sessions', mode: 'coop', target: 5, startDate: today(), endDate: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), invite: [b.handle] });

  const { status, body } = await app.request('/api/admin/users', { as: admin });
  assert.equal(status, 200);
  const row = body.users.find(u => u.id === a.id);
  assert.deepEqual(row.social, { enabled: true, friends: 1, challenges: 1 });
  const text = JSON.stringify(body);
  for (const secret of [a.handle, b.handle, 'Secret plan']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(body.users.find(u => u.id === admin.id).social, { enabled: false, friends: 0, challenges: 0 });
});

test('a disabled account vanishes from friends views at once, and comes back when re-enabled', async () => {
  const admin = app.createUser('boss2', { admin: true });
  const a = await person('dis_a'), b = await person('dis_b');
  await friends(a, b);
  await app.request('/api/data', { method: 'PUT', as: a, body: { state: { workouts: [session()] } } });
  assert.equal((await app.request('/api/social/friends', { as: b })).body.friends.length, 1);
  assert.equal((await app.request('/api/social/feed', { as: b })).body.events.length, 1);

  await app.request('/api/admin/user/disable', { method: 'POST', as: admin, body: { id: a.id, disabled: true } });
  assert.deepEqual((await app.request('/api/social/friends', { as: b })).body.friends, []);
  assert.deepEqual((await app.request('/api/social/friends/summary', { as: b })).body.friends, []);
  assert.deepEqual((await app.request('/api/social/feed', { as: b })).body.events, []);
  assert.equal((await post('friends/request', b, { handle: a.handle })).status, 404);

  await app.request('/api/admin/user/disable', { method: 'POST', as: admin, body: { id: a.id, disabled: false } });
  assert.equal((await app.request('/api/social/friends', { as: b })).body.friends.length, 1);
});
