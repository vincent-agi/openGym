import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { LIMITS } from '../challenges.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let db;
let seq = 0;

before(async () => { app = await startTestServer(); db = (await import('../server.js')).db; });
after(async () => { await app.close(); });

const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const session = d => ({ id: 'w' + d, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const save = (user, days) => app.request('/api/data', { method: 'PUT', as: user, body: { state: { routines: [], week: {}, dayPlan: {}, workouts: days.map(session) } } });
const post = (path, as, body) => app.request('/api/social/' + path, { method: 'POST', as, body });
const getAll = as => app.request('/api/social/challenges', { as });
const getOne = (as, id) => app.request('/api/social/challenge?id=' + id, { as });

async function sharingUser(label) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle, displayName: label } });
  return { ...user, handle };
}
async function befriend(a, b) {
  await post('friends/request', a, { handle: b.handle });
  await post('friends/respond', b, { handle: a.handle, action: 'accept' });
}
/** Two or three friends, ready to be invited. */
async function crew(n = 2) {
  const people = [];
  for (let i = 0; i < n; i++) people.push(await sharingUser('p' + i));
  for (let i = 1; i < n; i++) await befriend(people[0], people[i]);
  return people;
}
const body = (invite, extra = {}) => ({
  title: 'Autumn push', type: 'sessions', mode: 'versus', target: 10, startDate: iso(0), endDate: iso(27), invite: invite.map(p => p.handle), ...extra
});
const create = async (owner, invite, extra) => (await post('challenges', owner, body(invite, extra)));

test('every challenge route requires a session and sharing', async () => {
  for (const [method, path] of [['GET', 'challenges'], ['POST', 'challenges'], ['GET', 'challenge?id=x'], ['POST', 'challenges/join'], ['POST', 'challenges/leave'], ['POST', 'challenges/cancel']]) {
    assert.equal((await app.request('/api/social/' + path, { method, body: method === 'POST' ? {} : undefined })).status, 401, path);
  }
  const lurker = app.createUser('lurker');
  assert.equal((await getAll(lurker)).status, 403);
});

test('creating a challenge invites friends; the owner is in, the others are invited', async () => {
  const [owner, f1, f2] = await crew(3);
  const r = await create(owner, [f1, f2]);
  assert.equal(r.status, 200);
  const v = r.body.challenge;
  assert.equal(v.status, 'active');
  assert.deepEqual(v.participants.map(p => [p.handle, p.state]).sort(), [[owner.handle, 'joined'], [f1.handle, 'invited'], [f2.handle, 'invited']].sort());
  const mine = await getAll(f1);
  assert.equal(mine.body.challenges.length, 1);
  assert.equal(mine.body.challenges[0].id, v.id);
});

test('only accepted friends who are sharing can be invited, and the refusal is the same for all', async () => {
  const [owner, friend] = await crew(2);
  const stranger = await sharingUser('stranger');
  const quiet = await sharingUser('quiet');
  await befriend(owner, quiet);
  await app.request('/api/social/me', { method: 'PUT', as: quiet, body: { enabled: false } });
  const attempts = [[stranger], [quiet], [{ handle: 'nobody_here' }], [friend, stranger]];
  const results = [];
  for (const invite of attempts) results.push(await create(owner, invite));
  for (const r of results) assert.deepEqual({ s: r.status, b: r.body }, { s: 400, b: results[0].body });
});

test('invalid input answers 400 with a message', async () => {
  const [owner, friend] = await crew(2);
  const r = await create(owner, [friend], { target: 0 });
  assert.equal(r.status, 400);
  assert.equal(typeof r.body.error, 'string');
});

test('an invited friend joins, and non-participants cannot see the challenge', async () => {
  const [owner, friend] = await crew(2);
  const outsider = await sharingUser('outsider');
  const { challenge } = (await create(owner, [friend])).body;
  assert.equal((await getOne(outsider, challenge.id)).status, 404);
  assert.equal((await post('challenges/join', outsider, { id: challenge.id })).status, 404);

  const joined = await post('challenges/join', friend, { id: challenge.id });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.challenge.participants.find(p => p.handle === friend.handle).state, 'joined');
  assert.equal((await post('challenges/join', friend, { id: challenge.id })).status, 404);   // already in
});

test('progress comes from each person saved sessions, never from the request', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  await save(owner, [iso(0)]);
  await save(friend, [iso(0)]);
  const forged = await app.request('/api/data', { method: 'PUT', as: friend, body: { state: { workouts: [session(iso(0))], progress: { sessions: 99 }, challengeProgress: 99 } } });
  assert.equal(forged.status, 200);
  const v = (await getOne(owner, challenge.id)).body.challenge;
  assert.deepEqual(v.participants.map(p => p.current), [1, 1]);
});

test('versus ranks the people who joined; co-op adds them up', async () => {
  const [owner, friend] = await crew(2);
  const versus = (await create(owner, [friend])).body.challenge;
  const coop = (await create(owner, [friend], { mode: 'coop', target: 4 })).body.challenge;
  await post('challenges/join', friend, { id: versus.id });
  await post('challenges/join', friend, { id: coop.id });
  await save(owner, [iso(0)]);
  await save(friend, [iso(0)]);

  const v = (await getOne(owner, versus.id)).body.challenge;
  assert.deepEqual(v.participants.map(p => p.position), [1, 1]);
  const c = (await getOne(owner, coop.id)).body.challenge;
  assert.equal(c.total, 2);
  assert.equal(c.pct, 0.5);
  assert.ok(c.participants.every(p => p.position === null));
});

test('leaving removes you from the ranking; you can rejoin while it is running and count from then', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  assert.equal((await post('challenges/leave', friend, { id: challenge.id })).status, 200);
  const left = (await getOne(owner, challenge.id)).body.challenge.participants.find(p => p.handle === friend.handle);
  assert.deepEqual([left.state, left.current], ['left', null]);
  assert.equal((await post('challenges/join', friend, { id: challenge.id })).status, 200);
});

test('a late joiner only gets credit from the day they joined', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  const ch = db.challenges.find(c => c.id === challenge.id);
  ch.startDate = iso(-10);                      // pretend it started ten days ago
  await save(friend, [iso(-5), iso(0)]);        // an earlier session, then one today
  await post('challenges/join', friend, { id: challenge.id });
  await save(friend, [iso(-5), iso(0)]);
  const p = (await getOne(owner, challenge.id)).body.challenge.participants.find(x => x.handle === friend.handle);
  assert.equal(p.current, 1);
});

test('only the owner can cancel, and a cancelled challenge stops counting', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  assert.equal((await post('challenges/cancel', friend, { id: challenge.id })).status, 404);
  assert.equal((await post('challenges/cancel', owner, { id: challenge.id })).status, 200);
  assert.equal((await getOne(friend, challenge.id)).body.challenge.status, 'cancelled');
});

test('nobody can be in more than five live challenges', async () => {
  const [owner, friend] = await crew(2);
  for (let i = 0; i < LIMITS.maxActivePerUser; i++) assert.equal((await create(owner, [friend])).status, 200);
  assert.equal((await create(owner, [friend])).status, 409);
  const [first] = (await getAll(friend)).body.challenges;
  for (const c of (await getAll(friend)).body.challenges.slice(0, LIMITS.maxActivePerUser)) await post('challenges/join', friend, { id: c.id });
  const extra = await sharingUser('extra_owner');
  await befriend(extra, friend);
  const sixth = (await create(extra, [friend])).body.challenge;
  assert.equal((await post('challenges/join', friend, { id: sixth.id })).status, 409);
  assert.ok(first);
});

test('stopping sharing pauses you; days spent paused never count once you are back', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  await app.request('/api/social/me', { method: 'PUT', as: friend, body: { enabled: false } });
  assert.equal((await getOne(owner, challenge.id)).body.challenge.participants.find(p => p.handle === friend.handle).state, 'paused');

  db.challenges.find(c => c.id === challenge.id).startDate = iso(-6);
  const part = db.challenges.find(c => c.id === challenge.id).participants.find(p => p.uid === friend.id);
  part.joinedDate = iso(-6);
  part.pausedFrom = iso(-4);                                        // paused four days ago
  await app.request('/api/data', { method: 'PUT', as: friend, body: { state: { workouts: [session(iso(-3)), session(iso(-5)), session(iso(0))] } } });
  await app.request('/api/social/me', { method: 'PUT', as: friend, body: { enabled: true } });
  const p = (await getOne(owner, challenge.id)).body.challenge.participants.find(x => x.handle === friend.handle);
  assert.equal(p.state, 'joined');
  assert.equal(p.current, 2);        // day -5 (before the pause) and today; day -3 happened while paused
});

test('a finished challenge is frozen with its final results', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  await save(owner, [iso(0)]);
  const ch = db.challenges.find(c => c.id === challenge.id);
  ch.startDate = iso(-10); ch.endDate = iso(-1);
  const first = (await getOne(owner, challenge.id)).body.challenge;
  assert.equal(first.status, 'ended');
  await save(owner, [iso(0), iso(-2), iso(-3)]);
  const again = (await getOne(owner, challenge.id)).body.challenge;
  assert.deepEqual(again.participants, first.participants);
});

test('when the owner leaves, the challenge passes to someone still in, or ends if nobody is', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  await post('challenges/leave', owner, { id: challenge.id });
  assert.equal(db.challenges.find(c => c.id === challenge.id).ownerId, friend.id);
  await post('challenges/leave', friend, { id: challenge.id });
  assert.equal((await getOne(friend, challenge.id)).body.challenge.status, 'cancelled');
});

test('blocking or removing someone takes you out of the challenges you share, for good', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });

  await post('friends/block', friend, { handle: owner.handle });             // the friend blocks the owner
  const list = (await getAll(friend)).body.challenges;
  assert.ok(!list.some(c => c.id === challenge.id));                          // the blocker is out
  assert.equal((await getOne(friend, challenge.id)).status, 404);
  const ch = db.challenges.find(c => c.id === challenge.id);
  assert.ok(!ch.participants.some(p => p.uid === friend.id));
  assert.ok(!(db.challengeProgress[challenge.id] || {})[friend.id]);
  assert.equal((await getOne(owner, challenge.id)).body.challenge.participants.length, 1);
});

test('when the one who ends a friendship owns the challenge, it passes to someone who stays', async () => {
  const [owner, f1, f2] = await crew(3);
  await befriend(f1, f2);
  const { challenge } = (await create(owner, [f1, f2])).body;
  await post('challenges/join', f1, { id: challenge.id });
  await post('challenges/join', f2, { id: challenge.id });
  await post('friends/remove', owner, { handle: f1.handle });
  const ch = db.challenges.find(c => c.id === challenge.id);
  assert.notEqual(ch.ownerId, owner.id);
  assert.ok([f1.id, f2.id].includes(ch.ownerId));
});

test('maintenance freezes a finished challenge even if nobody opens it', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  await post('challenges/join', friend, { id: challenge.id });
  await save(owner, [iso(0)]);
  const ch = db.challenges.find(c => c.id === challenge.id);
  ch.startDate = iso(-10); ch.endDate = iso(-1);
  assert.equal(ch.final, undefined);
  await (await import('../server.js')).runSocialMaintenance();
  assert.ok(ch.final);
  assert.equal(ch.final.status, 'ended');
});

test('maintenance forgets challenges, their progress and expired friend codes after the retention period', async () => {
  const [owner, friend] = await crew(2);
  const { challenge } = (await create(owner, [friend])).body;
  const ch = db.challenges.find(c => c.id === challenge.id);
  ch.startDate = iso(-200); ch.endDate = iso(-120);
  db.challengeProgress[ch.id] = { [owner.id]: { sessions: 1, days: [], weeks: [] } };
  db.friendCodes.push({ code: 'STALECODE1', uid: owner.id, createdAt: 1, expiresAt: Date.now() - 3 * 86400000 });
  await (await import('../server.js')).runSocialMaintenance();
  assert.ok(!db.challenges.some(c => c.id === challenge.id));
  assert.equal(db.challengeProgress[challenge.id], undefined);
  assert.ok(!db.friendCodes.some(c => c.code === 'STALECODE1'));
});
