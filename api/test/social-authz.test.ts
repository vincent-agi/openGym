import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, SOCIAL_ROUTES } from './helpers.ts';
import { loadServer } from './helpers.ts';
import type { Json, Person, ServerModule, TestServer, TestUser } from './helpers.ts';

/**
 * Authorization matrix of the social module.
 *
 * Owner "A" has a session event, a challenge and a friend code. Each kind of outsider then tries
 * everything A has: they must get nothing, and the *same* nothing, whatever their relationship.
 */

let app: TestServer;
let mod: ServerModule;
let seq = 0;

before(async () => { app = await startTestServer(); mod = await loadServer(); });
after(async () => { await app.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const later = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const call = (method: string, path: string, as?: TestUser, body?: unknown) => app.request(path, { method, as, body });

async function person(label: string): Promise<Person> {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await call('PUT', '/api/social/me', user, { enabled: true, handle, displayName: label });
  return { ...user, handle };
}

/** Owner A with private things, and one person per relationship. */
interface Scene {
  owner: Person
  anonymous: undefined
  silent: TestUser
  stranger: Person
  pending: Person
  friend: Person
  blocked: Person
  removed: Person
  eventId: string
  challengeId: string
}

async function scene(): Promise<Scene> {
  const owner = await person('owner');
  const silent = app.createUser('silent');
  const stranger = await person('stranger');
  const pending = await person('pending');
  const friend = await person('friend');
  const blocked = await person('blocked');
  const removed = await person('removed');
  const world: Scene = { owner, anonymous: undefined, silent, stranger, pending, friend, blocked, removed, eventId: '', challengeId: '' };

  await call('POST', '/api/social/friends/request', world.pending, { handle: owner.handle });
  for (const f of [world.friend, world.blocked, world.removed]) {
    await call('POST', '/api/social/friends/request', owner, { handle: f.handle });
    await call('POST', '/api/social/friends/respond', f, { handle: owner.handle, action: 'accept' });
  }
  const w = [{ id: 'w1', d: today(), entries: [{ id: 'x', sets: [{ done: true }] }] }];
  await call('PUT', '/api/data', owner, { state: { workouts: w } });
  world.eventId = (await call('GET', '/api/social/feed', world.friend)).body.events[0].id;
  const made = await call('POST', '/api/social/challenges', owner, {
    title: 'Private challenge', type: 'sessions', mode: 'versus', target: 5, startDate: today(), endDate: later(20), invite: [world.friend.handle]
  });
  world.challengeId = made.body.challenge.id;
  // Cheers by these people must be deleted when the friendship ends.
  await call('POST', '/api/social/cheer', world.blocked, { eventId: world.eventId, emoji: '🔥' });
  await call('POST', '/api/social/friends/block', owner, { handle: world.blocked.handle });
  await call('POST', '/api/social/friends/remove', owner, { handle: world.removed.handle });
  return world;
}

test('the matrix covers exactly the routes the server registers', () => {
  const registered = mod.socialRouteKeys().sort();
  const covered = SOCIAL_ROUTES.map(([m, p]) => `${m} ${p}`).sort();
  assert.deepEqual(covered, registered);
});

test('every social route answers 401 without a session', async () => {
  for (const [method, path] of SOCIAL_ROUTES) {
    const r = await call(method, path, undefined, method === 'GET' ? undefined : {});
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test('every route that needs sharing answers 403 to someone who is not sharing', async () => {
  const silent = app.createUser('quiet_one');
  const open = new Set(['GET /api/social/me', 'PUT /api/social/me', 'POST /api/social/leave']);
  for (const [method, path] of SOCIAL_ROUTES) {
    if (open.has(`${method} ${path}`)) continue;
    const r = await call(method, path, silent, method === 'GET' ? undefined : {});
    assert.equal(r.status, 403, `${method} ${path}`);
  }
});

test('outsiders get the same answer for everything the owner has', async () => {
  const w = await scene();
  const outsiders = { stranger: w.stranger, pending: w.pending, blocked: w.blocked, removed: w.removed };
  const attacks: Array<[string, string, unknown]> = [
    ['GET', `/api/social/challenge?id=${w.challengeId}`, undefined],
    ['POST', '/api/social/challenges/join', { id: w.challengeId }],
    ['POST', '/api/social/challenges/leave', { id: w.challengeId }],
    ['POST', '/api/social/challenges/cancel', { id: w.challengeId }],
    ['POST', '/api/social/cheer', { eventId: w.eventId, emoji: '🔥' }],
    ['POST', '/api/social/cheer/mute', { handle: w.owner.handle, muted: true }],
    ['POST', '/api/social/friends/respond', { handle: w.owner.handle, action: 'accept' }],
    ['POST', '/api/social/friends/remove', { handle: w.owner.handle }],
    ['POST', '/api/social/friends/unblock', { handle: w.owner.handle }]
  ];
  for (const [label, user] of Object.entries(outsiders)) {
    const answers: string[] = [];
    for (const [method, path, body] of attacks) {
      const r = await call(method, path, user, body);
      assert.equal(r.status, 404, `${label}: ${method} ${path}`);
      answers.push(JSON.stringify(r.body));
    }
    assert.deepEqual([...new Set(answers)], ['{"error":"not found"}'], label);
  }
});

test('asking to be friends again is only possible for people who are not blocked, and always looks the same when it is not', async () => {
  const w = await scene();
  const answer = async (user: Json) => call('POST', '/api/social/friends/request', user, { handle: w.owner.handle });
  const blocked = await answer(w.blocked);
  const pending = await answer(w.pending);                  // already asked: a duplicate
  const unknown = await call('POST', '/api/social/friends/request', w.stranger, { handle: 'nobody_at_all' });
  assert.deepEqual([blocked.status, pending.status, unknown.status], [404, 404, 404]);
  assert.deepEqual(blocked.body, pending.body);
  assert.deepEqual(blocked.body, unknown.body);
  assert.equal((await answer(w.stranger)).status, 200);     // an ordinary stranger may ask, as designed
  assert.equal((await answer(w.removed)).status, 200);      // so may someone who was removed
});

test('outsiders see none of the owner data in lists', async () => {
  const w = await scene();
  for (const [label, user] of Object.entries({ stranger: w.stranger, pending: w.pending, blocked: w.blocked, removed: w.removed })) {
    const summary = (await call('GET', '/api/social/friends/summary', user)).body;
    assert.ok(!summary.friends.some((f: Json) => f.handle === w.owner.handle), `${label}: summary`);
    const feed = (await call('GET', '/api/social/feed', user)).body;
    assert.ok(!feed.events.some((e: Json) => e.handle === w.owner.handle), `${label}: feed`);
    const friends = (await call('GET', '/api/social/friends', user)).body;
    assert.ok(!friends.friends.some((f: Json) => f.handle === w.owner.handle), `${label}: friends`);
    const challenges = (await call('GET', '/api/social/challenges', user)).body.challenges;
    assert.ok(!challenges.some((c: Json) => c.id === w.challengeId), `${label}: challenges`);
  }
});

test('an accepted friend, by contrast, sees exactly the shared parts', async () => {
  const w = await scene();
  assert.ok((await call('GET', '/api/social/friends/summary', w.friend)).body.friends.some((f: Json) => f.handle === w.owner.handle));
  assert.ok((await call('GET', '/api/social/feed', w.friend)).body.events.some((e: Json) => e.handle === w.owner.handle));
  assert.equal((await call('GET', `/api/social/challenge?id=${w.challengeId}`, w.friend)).status, 200);
  assert.equal((await call('POST', '/api/social/cheer', w.friend, { eventId: w.eventId, emoji: '👏' })).status, 200);
});

test('the blocked and removed people cannot invite the owner to anything', async () => {
  const w = await scene();
  for (const user of [w.blocked, w.removed, w.stranger]) {
    const r = await call('POST', '/api/social/challenges', user, { title: 'x', type: 'sessions', mode: 'coop', target: 3, startDate: today(), endDate: later(10), invite: [w.owner.handle] });
    assert.equal(r.status, 400);
  }
});

test('cheers between people who stopped being friends are gone', async () => {
  const w = await scene();
  assert.equal(mod.db.socialCheers.filter((c: Json) => c.from === w.blocked.id).length, 0);
});

test('no social route reads another user saved state', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const files = fs.readdirSync(dir).filter(f => /\.(js|ts)$/.test(f) && !['server.js', 'server.ts', 'types.ts'].includes(f));
  assert.ok(files.length >= 14, `expected the social modules, found only ${files.join(', ')}`);   // a rename must never empty this scan
  for (const f of files) {
    const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/\breadState\(([^)]*)\)/g)) {
      assert.match(m[1].trim(), /^(user|u)\.id$|^uid$/, `${f}: readState(${m[1]})`);
    }
  }
});
