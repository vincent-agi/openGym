import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let seq = 0;

before(async () => { app = await startTestServer(); });
after(async () => { await app.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const call = (method, path, as, body, ip) => app.request(path, { method, as, body, ip });
let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`;

async function person(label) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await call('PUT', '/api/social/me', user, { enabled: true, handle, displayName: label });
  return { ...user, handle };
}

test('friend requests are limited to ten an hour, then answer 429 with a Retry-After', async () => {
  const me = await person('spammer'); const ip = freshIp();
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/social/friends/request', me, { handle: 'nobody_' + i }, ip)).status, 404);
  const r = await call('POST', '/api/social/friends/request', me, { handle: 'nobody_x' }, ip);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.equal(typeof r.body.error, 'string');
});

test('guessing friend codes is limited to twenty an hour, then the wait doubles', async () => {
  const me = await person('guesser'); const ip = freshIp();
  for (let i = 0; i < 20; i++) assert.equal((await call('POST', '/api/social/friends/request', me, { code: 'ZZZZZZZZZZ' }, ip)).status, 404);
  const waits = [];
  for (let i = 0; i < 3; i++) waits.push(Number((await call('POST', '/api/social/friends/request', me, { code: 'ZZZZZZZZZZ' }, ip)).headers.get('retry-after')));
  assert.deepEqual(waits, [60, 120, 240]);
});

test('the limit is shared by everyone behind the same address', async () => {
  const a = await person('ip_a'), b = await person('ip_b'); const ip = freshIp();
  for (let i = 0; i < 10; i++) await call('POST', '/api/social/friends/request', a, { handle: 'nobody_' + i }, ip);
  assert.equal((await call('POST', '/api/social/friends/request', b, { handle: 'nobody_z' }, ip)).status, 429);
  assert.equal((await call('POST', '/api/social/friends/request', b, { handle: 'nobody_z' }, freshIp())).status, 404);   // elsewhere: fine
});

test('and one person cannot dodge their limit by changing address', async () => {
  const me = await person('mover');
  for (let i = 0; i < 10; i++) await call('POST', '/api/social/friends/request', me, { handle: 'nobody_' + i }, freshIp());
  assert.equal((await call('POST', '/api/social/friends/request', me, { handle: 'nobody_z' }, freshIp())).status, 429);
});

test('cheers are limited to sixty an hour', async () => {
  const me = await person('cheerer'); const ip = freshIp();
  for (let i = 0; i < 60; i++) assert.equal((await call('POST', '/api/social/cheer', me, { eventId: 'nope', emoji: '🔥' }, ip)).status, 404);
  assert.equal((await call('POST', '/api/social/cheer', me, { eventId: 'nope', emoji: '🔥' }, ip)).status, 429);
});

test('creating challenges is limited to ten a day, even when each attempt is refused', async () => {
  const me = await person('creator'); const ip = freshIp();
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/api/social/challenges', me, { title: '' }, ip)).status, 400);
  assert.equal((await call('POST', '/api/social/challenges', me, { title: '' }, ip)).status, 429);
});

test('an ordinary use of the social features is never slowed down', async () => {
  const a = await person('normal_a'), b = await person('normal_b'); const ip = freshIp();
  assert.equal((await call('POST', '/api/social/friends/request', a, { handle: b.handle }, ip)).status, 200);
  assert.equal((await call('POST', '/api/social/friends/respond', b, { handle: a.handle, action: 'accept' }, ip)).status, 200);
  for (let i = 0; i < 30; i++) assert.equal((await call('GET', '/api/social/feed', a, undefined, ip)).status, 200);
});

test('nothing outside the social module is limited', async () => {
  const me = await person('saver'); const ip = freshIp();
  for (let i = 0; i < 80; i++) assert.equal((await call('PUT', '/api/data', me, { state: { n: i } }, ip)).status, 200);
  assert.equal((await call('GET', '/api/health', undefined, undefined, ip)).status, 200);
});

test('the limits are per action: using up one does not block another', async () => {
  const me = await person('mixed'); const ip = freshIp();
  for (let i = 0; i < 10; i++) await call('POST', '/api/social/friends/request', me, { handle: 'nobody_' + i }, ip);
  assert.equal((await call('POST', '/api/social/friends/request', me, { handle: 'x' }, ip)).status, 429);
  assert.equal((await call('GET', '/api/social/friends', me, undefined, ip)).status, 200);
  assert.equal((await call('POST', '/api/social/friends/code', me, {}, ip)).status, 200);
  assert.ok(today());
});
