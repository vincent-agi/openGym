import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { SUMMARY_KEYS } from '../summary.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let seq = 0;

before(async () => { app = await startTestServer(); });
after(async () => { await app.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const session = d => ({ id: 'w' + d, d, entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }] });

async function sharingUser(label, share) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle, displayName: label, ...(share ? { share } : {}) } });
  return { ...user, handle };
}
async function befriend(a, b) {
  await app.request('/api/social/friends/request', { method: 'POST', as: a, body: { handle: b.handle } });
  await app.request('/api/social/friends/respond', { method: 'POST', as: b, body: { handle: a.handle, action: 'accept' } });
}
const save = (user, state) => app.request('/api/data', { method: 'PUT', as: user, body: { state } });
const feed = as => app.request('/api/social/friends/summary', { as });

test('the friends summary requires a session and sharing', async () => {
  assert.equal((await app.request('/api/social/friends/summary')).status, 401);
  assert.equal((await feed(app.createUser('quiet'))).status, 403);
});

test('a friend sees the summary computed from the last saved state', async () => {
  const lea = await sharingUser('lea');
  const marc = await sharingUser('marc');
  await befriend(lea, marc);
  await save(lea, { workouts: [session(today())], week: {}, routines: [], dayPlan: {} });

  const { status, body } = await feed(marc);
  assert.equal(status, 200);
  assert.equal(body.friends.length, 1);
  const row = body.friends[0];
  assert.equal(row.handle, lea.handle);
  assert.equal(row.displayName, 'lea');
  assert.equal(row.summary.weekSessions, 1);
  assert.deepEqual(row.summary.activeDays, [today()]);
  assert.equal(row.stale, false);
});

test('the summary only ever carries whitelisted keys, whatever the state contains', async () => {
  const a = await sharingUser('keys_a', { sessions: true, streak: true, consistency: true, prs: true });
  const b = await sharingUser('keys_b');
  await befriend(a, b);
  await save(a, {
    workouts: [session(today())], bodyweight: [{ d: today(), w: 123.4 }], nutrition: { goal: 'cut', log: { x: [{ name: 'cake', kcal: 999 }] } },
    measurements: { [today()]: { waist: 77 } }, mobilityLevel: 'wheelchair', socialSummary: { weekSessions: 999 }
  });
  const row = (await feed(b)).body.friends[0];
  for (const k of Object.keys(row.summary)) assert.ok(SUMMARY_KEYS.includes(k), `unexpected key ${k}`);
  const text = JSON.stringify((await feed(b)).body);
  for (const secret of ['123.4', 'cake', '999', 'waist', 'wheelchair', '0025']) assert.ok(!text.includes(secret), secret);
  assert.equal(row.summary.weekSessions, 1);   // the forged client field is ignored
});

test('fields the owner did not share are left out', async () => {
  const a = await sharingUser('some_a', { sessions: true, streak: false, consistency: false, prs: false });
  const b = await sharingUser('some_b');
  await befriend(a, b);
  await save(a, { workouts: [session(today())] });
  const { summary } = (await feed(b)).body.friends[0];
  assert.ok('weekSessions' in summary);
  assert.ok(!('streakWeeks' in summary) && !('weekConsistency' in summary) && !('prCount' in summary));
});

test('strangers, pending requests and blocked users see nothing', async () => {
  const a = await sharingUser('priv_a');
  const stranger = await sharingUser('priv_stranger');
  const pending = await sharingUser('priv_pending');
  await save(a, { workouts: [session(today())] });
  await app.request('/api/social/friends/request', { method: 'POST', as: pending, body: { handle: a.handle } });
  assert.deepEqual((await feed(stranger)).body.friends, []);
  assert.deepEqual((await feed(pending)).body.friends, []);
  await befriend(a, stranger);
  await app.request('/api/social/friends/block', { method: 'POST', as: a, body: { handle: stranger.handle } });
  assert.deepEqual((await feed(stranger)).body.friends, []);
});

test('a friend who has not synced yet shows up without a summary', async () => {
  const a = await sharingUser('new_a');
  const b = await sharingUser('new_b');
  await befriend(a, b);
  const row = (await feed(b)).body.friends.find(f => f.handle === a.handle);
  assert.equal(row.summary, null);
});

test('turning sharing off removes the summary at once, turning it on rebuilds it from the saved state', async () => {
  const a = await sharingUser('tog_a');
  const b = await sharingUser('tog_b');
  await befriend(a, b);
  await save(a, { workouts: [session(today()), session(yesterday())] });
  assert.equal((await feed(b)).body.friends.length, 1);

  await app.request('/api/social/me', { method: 'PUT', as: a, body: { enabled: false } });
  assert.deepEqual((await feed(b)).body.friends, []);
  const mod = await import('../server.js');
  assert.equal(mod.db.socialSummaries[a.id], undefined);

  await app.request('/api/social/me', { method: 'PUT', as: a, body: { enabled: true } });
  const row = (await feed(b)).body.friends[0];
  assert.equal(row.summary.weekSessions >= 1, true);
});

test('a summary older than 14 days is flagged stale', async () => {
  const a = await sharingUser('stale_a');
  const b = await sharingUser('stale_b');
  await befriend(a, b);
  await save(a, { workouts: [session(today())] });
  const mod = await import('../server.js');
  mod.db.socialSummaries[a.id].updatedAt = Date.now() - 15 * 86400000;
  assert.equal((await feed(b)).body.friends[0].stale, true);
});

test('users who never share are never summarised', async () => {
  const quiet = app.createUser('never');
  await save(quiet, { workouts: [session(today())] });
  const mod = await import('../server.js');
  assert.equal(mod.db.socialSummaries[quiet.id], undefined);
});

test('a failing summary never breaks saving the state', async () => {
  const a = await sharingUser('bad_a');
  const res = await save(a, { workouts: 'not-an-array', routines: 7, week: null });
  assert.equal(res.status, 200);
});

test('the response also carries the caller own row, built the same way as a friend row', async () => {
  const a = await sharingUser('me_a', { sessions: true, streak: false, consistency: false, prs: false });
  await save(a, { workouts: [session(today())] });
  const { body } = await feed(a);
  assert.equal(body.me.handle, a.handle);
  assert.equal(body.me.summary.weekSessions, 1);
  assert.ok(!('streakWeeks' in body.me.summary));
  assert.equal(body.me.hideRank, false);
});

test('each row says whether that person opted out of rankings', async () => {
  const a = await sharingUser('hr_a');
  const b = await sharingUser('hr_b');
  await befriend(a, b);
  await app.request('/api/social/me', { method: 'PUT', as: b, body: { hideRank: true } });
  const row = (await feed(a)).body.friends[0];
  assert.equal(row.hideRank, true);
});
