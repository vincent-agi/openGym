import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
import { createNotifier } from '../notifier.js';
import { defaultNotify } from '../notify-prefs.js';

/**
 * The social module is an add-on: whatever goes wrong inside it must never stop someone from
 * saving their training or changing their settings, and must never take the server down.
 */

/** @type {import('./helpers.js').TestServer} */
let app;
let db;

before(async () => { app = await startTestServer(); db = (await import('../server.js')).db; });
after(async () => { await app.close(); });

const session = d => ({ id: 'w' + d, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const today = () => new Date().toISOString().slice(0, 10);

async function sharing(label) {
  const user = app.createUser(label);
  await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle: label + '_r', displayName: label } });
  return user;
}

test('saving training still succeeds when the social data is corrupt', async () => {
  const user = await sharing('res_a');
  const saved = { friendships: db.friendships, challenges: db.challenges, socialEvents: db.socialEvents };
  Object.assign(db, { friendships: null, challenges: null, socialEvents: null });
  try {
    const r = await app.request('/api/data', { method: 'PUT', as: user, body: { state: { workouts: [session(today())] } } });
    assert.equal(r.status, 200);
    const back = await app.request('/api/data', { as: user });
    assert.equal(back.body.state.workouts.length, 1);          // the training was stored
  } finally { Object.assign(db, saved); }
});

test('changing social settings still succeeds when a follow-up step fails', async () => {
  const user = await sharing('res_b');
  const saved = db.challenges;
  db.challenges = null;
  try {
    const r = await app.request('/api/social/me', { method: 'PUT', as: user, body: { hideRank: true } });
    assert.equal(r.status, 200);
    assert.equal(r.body.social.hideRank, true);
  } finally { db.challenges = saved; }
});

test('a notification that fails reports false instead of rejecting', async () => {
  const notify = { ...defaultNotify(), cheerReceived: true };
  const db2 = { users: [{ id: 'u', social: { enabled: true, notify } }], subs: [{ userId: 'u' }], socialOutbox: null, socialPushLog: [] };
  const n = createNotifier({ db: db2, saveDb() {}, sendPush: async () => {}, readState: () => null });
  assert.equal(await n.notify('u', 'cheerReceived', { name: 'x', emoji: '🔥' }), false);
});

test('a push that cannot be sent does not stop the rest of the queue', async () => {
  const notify = { ...defaultNotify(), cheerReceived: true, challengeEnded: true };
  const user = { id: 'u', social: { enabled: true, notify } };
  const sent = [];
  const db2 = { users: [user], subs: [{ userId: 'u' }], socialOutbox: [], socialPushLog: [] };
  let calls = 0;
  const n = createNotifier({
    db: db2, saveDb() {}, readState: () => null,
    sendPush: async (uid, m) => { calls++; if (calls === 1) throw new Error('push service down'); sent.push(m.title); }
  });
  await n.notify('u', 'cheerReceived', { name: 'a', emoji: '🔥' });
  await n.notify('u', 'challengeEnded', { title: 'T' });
  await n.flush();
  assert.equal(sent.length, 1);
});
