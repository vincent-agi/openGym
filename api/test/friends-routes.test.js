import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let seq = 0;

before(async () => { app = await startTestServer(); });
after(async () => { await app.close(); });

/** Creates a user who opted in to sharing under a unique handle. */
async function sharingUser(label) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`.toLowerCase();
  const r = await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle, displayName: label } });
  assert.equal(r.status, 200);
  return { ...user, handle };
}
const post = (path, as, body) => app.request('/api/social/friends/' + path, { method: 'POST', as, body });
const list = as => app.request('/api/social/friends', { as });

test('every friend route requires a session', async () => {
  for (const [method, path] of [['GET', ''], ['POST', '/code'], ['POST', '/request'], ['POST', '/respond'], ['POST', '/remove'], ['POST', '/block'], ['POST', '/unblock']]) {
    const r = await app.request('/api/social/friends' + path, { method, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('a user who is not sharing cannot use friend routes', async () => {
  const lurker = app.createUser('lurker');
  assert.equal((await list(lurker)).status, 403);
  assert.equal((await post('code', lurker, {})).status, 403);
});

test('a friend code lets someone send a request, and the owner can accept it', async () => {
  const lea = await sharingUser('lea');
  const marc = await sharingUser('marc');
  const { body: codeBody } = await post('code', lea, {});
  assert.match(codeBody.code, /^[A-Z2-9]{10}$/);

  const sent = await post('request', marc, { code: codeBody.code });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.status, 'pending');
  assert.equal(sent.body.friend.handle, lea.handle);

  assert.equal((await list(lea)).body.incoming[0].handle, marc.handle);
  assert.equal((await list(marc)).body.outgoing[0].handle, lea.handle);

  assert.equal((await post('respond', lea, { handle: marc.handle, action: 'accept' })).status, 200);
  assert.deepEqual((await list(lea)).body.friends.map(f => f.handle), [marc.handle]);
  assert.deepEqual((await list(marc)).body.friends.map(f => f.handle), [lea.handle]);
});

test('codes are case-insensitive and can be used by several people', async () => {
  const host = await sharingUser('host');
  const g1 = await sharingUser('g1');
  const g2 = await sharingUser('g2');
  const { body } = await post('code', host, {});
  assert.equal((await post('request', g1, { code: body.code.toLowerCase() })).status, 200);
  assert.equal((await post('request', g2, { code: body.code })).status, 200);
});

test('generating a new code revokes the previous one', async () => {
  const lea = await sharingUser('rot');
  const other = await sharingUser('rotfriend');
  const first = (await post('code', lea, {})).body.code;
  const second = (await post('code', lea, {})).body.code;
  assert.notEqual(first, second);
  assert.equal((await post('request', other, { code: first })).status, 404);
  assert.equal((await post('request', other, { code: second })).status, 200);
});

test('a request can also be sent to an exact handle', async () => {
  const a = await sharingUser('byhandle_a');
  const b = await sharingUser('byhandle_b');
  assert.equal((await post('request', a, { handle: '@' + b.handle.toUpperCase() })).status, 200);
});

test('refusals are identical whether the user is unknown, silent, blocked, yourself or a duplicate', async () => {
  const me = await sharingUser('me');
  const ghost = app.createUser('ghost'); // never enabled sharing
  const silent = await sharingUser('silent');
  await app.request('/api/social/me', { method: 'PUT', as: silent, body: { enabled: false } });
  const blocker = await sharingUser('blocker');
  await post('block', blocker, { handle: me.handle });
  const dup = await sharingUser('dup');
  await post('request', me, { handle: dup.handle });

  const attempts = [
    { handle: 'does_not_exist' }, { handle: ghost.name }, { handle: silent.handle },
    { handle: blocker.handle }, { handle: me.handle }, { handle: dup.handle }, { code: 'ZZZZZZZZZZ' }
  ];
  const results = [];
  for (const body of attempts) results.push(await post('request', me, body));
  for (const r of results) assert.deepEqual({ s: r.status, b: r.body }, { s: results[0].status, b: results[0].body }, JSON.stringify(r));
  assert.equal(results[0].status, 404);
});

test('an expired code is refused', async () => {
  const lea = await sharingUser('exp');
  const other = await sharingUser('expfriend');
  const { body } = await post('code', lea, {});
  const mod = await import('../server.js');
  mod.db.friendCodes.find(c => c.code === body.code).expiresAt = Date.now() - 1000;
  assert.equal((await post('request', other, { code: body.code })).status, 404);
});

test('only the recipient can accept, and declining lets the sender try again later', async () => {
  const a = await sharingUser('acc_a');
  const b = await sharingUser('acc_b');
  await post('request', a, { handle: b.handle });
  assert.equal((await post('respond', a, { handle: b.handle, action: 'accept' })).status, 404);
  assert.equal((await post('respond', b, { handle: a.handle, action: 'decline' })).status, 200);
  assert.equal((await post('request', a, { handle: b.handle })).status, 200);
});

test('removing a friend works from either side', async () => {
  const a = await sharingUser('rm_a');
  const b = await sharingUser('rm_b');
  await post('request', a, { handle: b.handle });
  await post('respond', b, { handle: a.handle, action: 'accept' });
  assert.equal((await post('remove', b, { handle: a.handle })).status, 200);
  assert.deepEqual((await list(a)).body.friends, []);
  assert.equal((await post('remove', b, { handle: a.handle })).status, 404);
});

test('blocking removes the friendship, hides it from the blocked user and prevents new requests', async () => {
  const a = await sharingUser('bl_a');
  const b = await sharingUser('bl_b');
  await post('request', a, { handle: b.handle });
  await post('respond', b, { handle: a.handle, action: 'accept' });

  assert.equal((await post('block', a, { handle: b.handle })).status, 200);
  assert.deepEqual((await list(b)).body, { friends: [], incoming: [], outgoing: [], blocked: [] });
  assert.deepEqual((await list(a)).body.blocked, [{ handle: b.handle }]);
  assert.equal((await post('request', b, { handle: a.handle })).status, 404);

  assert.equal((await post('unblock', b, { handle: a.handle })).status, 404);
  assert.equal((await post('unblock', a, { handle: b.handle })).status, 200);
  assert.equal((await post('request', b, { handle: a.handle })).status, 200);
});

test('blocking an unknown handle answers like blocking a real one', async () => {
  const a = await sharingUser('bl_probe');
  const real = await sharingUser('bl_real');
  const x = await post('block', a, { handle: 'nobody_here' });
  const y = await post('block', a, { handle: real.handle });
  assert.deepEqual({ s: x.status, b: x.body }, { s: y.status, b: y.body });
});

test('a friend who stops sharing disappears from the list but the friendship is kept', async () => {
  const a = await sharingUser('hide_a');
  const b = await sharingUser('hide_b');
  await post('request', a, { handle: b.handle });
  await post('respond', b, { handle: a.handle, action: 'accept' });
  await app.request('/api/social/me', { method: 'PUT', as: b, body: { enabled: false } });
  assert.deepEqual((await list(a)).body.friends, []);
  await app.request('/api/social/me', { method: 'PUT', as: b, body: { enabled: true } });
  assert.equal((await list(a)).body.friends.length, 1);
});
