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
const session = (d = today(), id = 'w' + d) => ({ id, d, routineName: 'Secret push day', entries: [{ id: '0025', sets: [{ w: 140, r: 5, done: true }] }] });
const save = (user, workouts) => app.request('/api/data', { method: 'PUT', as: user, body: { state: { workouts } } });
const post = (path, as, body) => app.request('/api/social/' + path, { method: 'POST', as, body });
const feed = (as, q = '') => app.request('/api/social/feed' + q, { as });

async function sharingUser(label, share) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle, displayName: label, ...(share ? { share } : {}) } });
  return { ...user, handle };
}
async function friends() {
  const a = await sharingUser('fa'), b = await sharingUser('fb');
  await post('friends/request', a, { handle: b.handle });
  await post('friends/respond', b, { handle: a.handle, action: 'accept' });
  return [a, b];
}

test('feed and cheer routes require a session and sharing', async () => {
  assert.equal((await feed(undefined)).status, 401);
  assert.equal((await app.request('/api/social/cheer', { method: 'POST', body: {} })).status, 401);
  assert.equal((await feed(app.createUser('quiet'))).status, 403);
});

test('a friend finishing a session shows up in the feed with no workout detail', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const { status, body } = await feed(b);
  assert.equal(status, 200);
  assert.equal(body.events.length, 1);
  const e = body.events[0];
  assert.deepEqual(Object.keys(e).sort(), ['cheers', 'createdAt', 'date', 'displayName', 'handle', 'id', 'myCheer']);
  assert.equal(e.handle, a.handle);
  const text = JSON.stringify(body);
  for (const secret of ['Secret push day', '0025', '140']) assert.ok(!text.includes(secret), secret);
});

test('saving the same state again does not repeat the event', async () => {
  const [a, b] = await friends();
  await save(a, [session()]); await save(a, [session()]);
  assert.equal((await feed(b)).body.events.length, 1);
});

test('strangers and people who opted out of sharing sessions see and make nothing', async () => {
  const [a, b] = await friends();
  const stranger = await sharingUser('stranger');
  await save(a, [session()]);
  assert.deepEqual((await feed(stranger)).body.events, []);

  const [c, d] = await friends();
  await app.request('/api/social/me', { method: 'PUT', as: c, body: { share: { sessions: false } } });
  await save(c, [session()]);
  assert.deepEqual((await feed(d)).body.events, []);
  assert.ok(b);
});

test('a friend can cheer with a whitelisted emoji and the owner sees it grouped, by name', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  const r = await post('cheer', b, { eventId: event.id, emoji: '🔥' });
  assert.equal(r.status, 200);

  assert.deepEqual((await feed(b)).body.events[0].cheers, [{ emoji: '🔥', count: 1 }]);
  assert.equal((await feed(b)).body.events[0].myCheer, '🔥');
  const mine = (await feed(a)).body.mine[0];
  assert.deepEqual(mine.cheers, [{ emoji: '🔥', count: 1 }]);
  assert.deepEqual(mine.from, [{ emoji: '🔥', displayName: 'fb' }]);
});

test('only whitelisted emoji are accepted and free text is refused', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  for (const bad of [{ eventId: event.id, emoji: '🍕' }, { eventId: event.id, emoji: 'nice job!' }, { eventId: event.id, emoji: '🔥', text: 'hi' }, { eventId: event.id }]) {
    assert.equal((await post('cheer', b, bad)).status, 400, JSON.stringify(bad));
  }
});

test('one cheer per person per event: cheering again changes it, retracting removes it', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  await post('cheer', b, { eventId: event.id, emoji: '🔥' });
  await post('cheer', b, { eventId: event.id, emoji: '🎉' });
  assert.deepEqual((await feed(b)).body.events[0].cheers, [{ emoji: '🎉', count: 1 }]);
  assert.equal((await post('cheer/retract', b, { eventId: event.id })).status, 200);
  assert.deepEqual((await feed(b)).body.events[0].cheers, []);
});

test('you cannot cheer yourself, a stranger, or an event that does not exist', async () => {
  const [a, b] = await friends();
  const stranger = await sharingUser('stranger2');
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  const mine = (await feed(a)).body.mine[0];
  assert.equal((await post('cheer', a, { eventId: mine.id, emoji: '🔥' })).status, 404);
  assert.equal((await post('cheer', stranger, { eventId: event.id, emoji: '🔥' })).status, 404);
  assert.equal((await post('cheer', b, { eventId: 'nope', emoji: '🔥' })).status, 404);
});

test('muting a friend hides their cheers from you only', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  await post('cheer', b, { eventId: event.id, emoji: '💪' });
  assert.equal((await post('cheer/mute', a, { handle: b.handle, muted: true })).status, 200);
  assert.deepEqual((await feed(a)).body.mine[0].cheers, []);
  assert.deepEqual((await feed(b)).body.events[0].cheers, [{ emoji: '💪', count: 1 }]);
  await post('cheer/mute', a, { handle: b.handle, muted: false });
  assert.equal((await feed(a)).body.mine[0].cheers.length, 1);
});

test('the feed lists the friends you muted, so the app can offer to undo it', async () => {
  const [a, b] = await friends();
  assert.deepEqual((await feed(a)).body.muted, []);
  await post('cheer/mute', a, { handle: b.handle, muted: true });
  assert.deepEqual((await feed(a)).body.muted, [b.handle]);
  assert.deepEqual((await feed(b)).body.muted, []);                 // nobody learns they were muted
  await post('cheer/mute', a, { handle: b.handle, muted: false });
  assert.deepEqual((await feed(a)).body.muted, []);
});

test('removing or blocking a friend empties your feed of them and wipes cheers both ways', async () => {
  const [a, b] = await friends();
  await save(a, [session()]); await save(b, [session()]);
  const eventOfA = (await feed(b)).body.events[0];
  const eventOfB = (await feed(a)).body.events[0];
  await post('cheer', b, { eventId: eventOfA.id, emoji: '🔥' });
  await post('cheer', a, { eventId: eventOfB.id, emoji: '👏' });

  await post('friends/remove', a, { handle: b.handle });
  assert.deepEqual((await feed(b)).body.events, []);
  assert.deepEqual((await feed(a)).body.events, []);
  assert.equal(db.socialCheers.filter(c => c.from === a.id || c.from === b.id).length, 0);
});

test('blocking a friend also empties the feed and wipes the cheers', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  await post('cheer', b, { eventId: event.id, emoji: '🔥' });
  await post('friends/block', a, { handle: b.handle });
  assert.deepEqual((await feed(b)).body.events, []);
  assert.deepEqual((await feed(a)).body.mine[0].cheers, []);
  assert.equal(db.socialCheers.filter(c => c.eventId === event.id).length, 0);
});

test('events and cheers older than 30 days are forgotten', async () => {
  const [a, b] = await friends();
  await save(a, [session()]);
  const [event] = (await feed(b)).body.events;
  await post('cheer', b, { eventId: event.id, emoji: '🔥' });
  db.socialEvents.find(e => e.id === event.id).createdAt = Date.now() - 31 * 86400000;
  await save(a, [session(), session(today(), 'second')]);          // any new event triggers pruning
  assert.ok(!db.socialEvents.some(e => e.id === event.id));
  assert.ok(!db.socialCheers.some(c => c.eventId === event.id));
});

test('the feed is newest first and pages with before', async () => {
  const [a, b] = await friends();
  for (let i = 0; i < 3; i++) { await save(a, [session(today(), 'w' + i)]); }
  db.socialEvents.filter(e => e.uid === a.id).forEach((e, i) => { e.createdAt = 1000000 + i * 1000; });
  const all = (await feed(b)).body;
  assert.deepEqual(all.events.map(e => e.createdAt), [1002000, 1001000, 1000000]);
  const page = (await feed(b, '?before=1001500')).body;
  assert.deepEqual(page.events.map(e => e.createdAt), [1001000, 1000000]);
});
