import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let db;
let seq = 0;

before(async () => { app = await startTestServer(); db = (await import('../server.js')).db; });
after(async () => { await app.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const later = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const call = (method, path, as, body) => app.request(path, { method, as, body });
const post = (path, as, body) => call('POST', '/api/social/' + path, as, body);

async function person(label, notify) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await call('PUT', '/api/social/me', user, { enabled: true, handle, displayName: 'Name ' + label, ...(notify ? { notify } : {}) });
  return { ...user, handle };
}
async function friends(a, b) {
  await post('friends/request', a, { handle: b.handle });
  await post('friends/respond', b, { handle: a.handle, action: 'accept' });
}

/** What remains of a user in the shared database, outside the account records themselves. */
const residue = user => {
  const { users, creds, subs, invites, ...rest } = db;
  const text = JSON.stringify(rest);
  return [user.id, user.handle].filter(needle => text.includes(needle));
};

async function busyUser() {
  const tag = 'T' + (seq + 1);                      // makes challenge titles unique without naming anyone
  const me = await person('leaver', { cheerReceived: true });
  const f1 = await person('lf1'), f2 = await person('lf2'), blocker = await person('lblocker'), pending = await person('lpend');
  await friends(me, f1); await friends(me, f2); await friends(blocker, me);
  await post('friends/request', pending, { handle: me.handle });
  await post('friends/block', blocker, { handle: me.handle });
  await post('friends/code', me, {});
  const w = (id, d = today()) => ({ id, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
  await call('PUT', '/api/data', me, { state: { workouts: [w('a')] } });
  await call('PUT', '/api/data', f1, { state: { workouts: [w('b')] } });
  const mine = (await call('GET', '/api/social/feed', f1)).body.events.find(e => e.handle === me.handle);
  const theirs = (await call('GET', '/api/social/feed', me)).body.events.find(e => e.handle === f1.handle);
  await post('cheer', f1, { eventId: mine.id, emoji: '🔥' });
  await post('cheer', me, { eventId: theirs.id, emoji: '👏' });
  await post('cheer/mute', me, { handle: f1.handle, muted: true });
  await post('challenges', me, { title: 'Mine ' + tag, type: 'sessions', mode: 'coop', target: 4, startDate: today(), endDate: later(20), invite: [f1.handle, f2.handle] });
  await post('challenges', f1, { title: 'Theirs ' + tag, type: 'sessions', mode: 'versus', target: 4, startDate: today(), endDate: later(20), invite: [me.handle] });
  const theirsChallenge = db.challenges.find(c => c.title === 'Theirs ' + tag);
  await post('challenges/join', me, { id: theirsChallenge.id });
  db.socialOutbox.push({ id: 'o', uid: me.id, kind: 'cheerReceived', data: {}, createdAt: 1, deliverAt: 2 });
  db.socialPushLog.push({ uid: me.id, kind: 'cheerReceived', ts: Date.now(), date: today() });
  return { me, f1, f2, blocker, pending, tag };
}

test('leaving needs a session and an explicit confirmation', async () => {
  assert.equal((await call('POST', '/api/social/leave', undefined, { confirm: true })).status, 401);
  const user = await person('careful');
  assert.equal((await post('leave', user, {})).status, 400);
  assert.equal((await post('leave', user, { confirm: 'yes' })).status, 400);
  assert.equal((await call('GET', '/api/social/me', user)).body.social.enabled, true);
});

test('leaving erases every trace of the user from the shared database', async () => {
  const { me } = await busyUser();
  assert.ok(residue(me).length > 0, 'the fixture should leave traces before erasing');
  assert.equal((await post('leave', me, { confirm: true })).status, 200);
  assert.deepEqual(residue(me), []);
});

test('after leaving the user is back to the private defaults and can start again', async () => {
  const { me } = await busyUser();
  await post('leave', me, { confirm: true });
  const { body } = await call('GET', '/api/social/me', me);
  assert.equal(body.social.enabled, false);
  assert.equal(body.social.handle, '');
  assert.deepEqual(body.social.earned, []);
  assert.equal((await call('PUT', '/api/social/me', me, { enabled: true, handle: 'fresh_start', displayName: 'Again' })).status, 200);
});

test('the others keep what is theirs, and challenges are handed over or cancelled', async () => {
  const { me, f1, f2, tag } = await busyUser();
  await post('leave', me, { confirm: true });
  assert.equal((await call('GET', '/api/social/friends', f1)).body.friends.some(f => f.handle === me.handle), false);
  assert.equal((await call('GET', '/api/social/friends', f2)).body.friends.length, 0);
  const mine = db.challenges.find(c => c.title === 'Mine ' + tag);
  assert.ok(mine.status === 'cancelled' || [f1.id, f2.id].includes(mine.ownerId));
  assert.ok(!mine.participants.some(p => p.uid === me.id));
  const theirs = db.challenges.find(c => c.title === 'Theirs ' + tag);
  assert.equal(theirs.ownerId, f1.id);
  assert.ok(!theirs.participants.some(p => p.uid === me.id));
});

test('leaving also works for someone who had already stopped sharing', async () => {
  const { me } = await busyUser();
  await call('PUT', '/api/social/me', me, { enabled: false });
  assert.equal((await post('leave', me, { confirm: true })).status, 200);
  assert.deepEqual(residue(me), []);
});

test('a frozen final result of an ended challenge no longer names the person who left', async () => {
  const me = await person('gone'), f = await person('stays');
  await friends(me, f);
  const { body } = await post('challenges', me, { title: 'Done deal', type: 'sessions', mode: 'versus', target: 3, startDate: today(), endDate: later(10), invite: [f.handle] });
  await post('challenges/join', f, { id: body.challenge.id });
  const ch = db.challenges.find(c => c.id === body.challenge.id);
  ch.startDate = later(-10); ch.endDate = later(-1);
  await call('GET', `/api/social/challenge?id=${ch.id}`, me);                  // freezes the final results
  assert.ok(ch.final);
  await post('leave', me, { confirm: true });
  assert.ok(!JSON.stringify(ch.final).includes(me.handle));
});
