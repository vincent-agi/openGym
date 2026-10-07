import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';

/** @type {import('./helpers.js').TestServer} */
let app;
let mod;
let seq = 0;

before(async () => { app = await startTestServer(); mod = await import('../server.js'); });
after(async () => { await app.close(); });

const today = () => new Date().toISOString().slice(0, 10);
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const session = (d = today(), id = 'w' + d) => ({ id, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const save = (user, days) => app.request('/api/data', { method: 'PUT', as: user, body: { state: { workouts: days.map(d => session(d)) } } });
const post = (path, as, body) => app.request('/api/social/' + path, { method: 'POST', as, body });
const outbox = (user, kind) => mod.db.socialOutbox.filter(i => i.uid === user.id && (!kind || i.kind === kind));

const ALL_ON = { friendSession: true, cheerReceived: true, challengeInvite: true, challengeMilestone: true, challengeEnded: true };

/** A sharing user, optionally subscribed to push, with the given notification preferences. */
async function person(label, { notify = ALL_ON, subscribed = true, share } = {}) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  const r = await app.request('/api/social/me', { method: 'PUT', as: user, body: { enabled: true, handle, displayName: label, notify, ...(share ? { share } : {}) } });
  assert.equal(r.status, 200);
  if (subscribed) mod.db.subs.push({ userId: user.id, endpoint: 'https://push.invalid/' + user.id, keys: {} });
  return { ...user, handle };
}
async function friends(a, b) {
  await post('friends/request', a, { handle: b.handle });
  await post('friends/respond', b, { handle: a.handle, action: 'accept' });
}

test('notification preferences are stored with the social settings', async () => {
  const user = await person('prefs', { notify: { cheerReceived: true, quiet: { from: '22:00', to: '07:00' } } });
  const { body } = await app.request('/api/social/me', { as: user });
  assert.equal(body.social.notify.cheerReceived, true);
  assert.equal(body.social.notify.friendSession, false);
  assert.deepEqual(body.social.notify.quiet, { from: '22:00', to: '07:00' });
});

test('a friend finishing a session queues one notification for each friend who asked for it', async () => {
  const a = await person('ses_a'), b = await person('ses_b'), c = await person('ses_c', { notify: {} });
  await friends(a, b); await friends(a, c);
  await save(a, [today()]);
  const waiting = outbox(b, 'friendSession');
  assert.equal(waiting.length, 1);
  assert.deepEqual(waiting[0].data.names, ['ses_a']);
  assert.equal(outbox(c).length, 0);       // c never opted in
  assert.equal(outbox(a).length, 0);       // nobody is told about their own session
});

test('no notification when the friend does not share sessions, or the same state is saved again', async () => {
  const a = await person('priv_a', { share: { sessions: false } }), b = await person('priv_b');
  await friends(a, b);
  await save(a, [today()]);
  assert.equal(outbox(b).length, 0);

  const c = await person('rep_a'), d = await person('rep_b');
  await friends(c, d);
  await save(c, [today()]); await save(c, [today()]);
  assert.equal(outbox(d, 'friendSession').length, 1);
});

test('strangers are never notified', async () => {
  const a = await person('str_a'), stranger = await person('str_b');
  await save(a, [today()]);
  assert.equal(outbox(stranger).length, 0);
});

test('a new cheer notifies the owner, but changing it does not notify again', async () => {
  const a = await person('ch_a'), b = await person('ch_b');
  await friends(a, b);
  await save(a, [today()]);
  const [event] = (await app.request('/api/social/feed', { as: b })).body.events;
  await post('cheer', b, { eventId: event.id, emoji: '🔥' });
  assert.equal(outbox(a, 'cheerReceived').length, 1);
  assert.equal(outbox(a, 'cheerReceived')[0].data.emoji, '🔥');
  await post('cheer', b, { eventId: event.id, emoji: '🎉' });
  assert.equal(outbox(a, 'cheerReceived').length, 1);
});

test('a muted friend does not notify you when they cheer', async () => {
  const a = await person('mu_a'), b = await person('mu_b');
  await friends(a, b);
  await save(a, [today()]);
  const [event] = (await app.request('/api/social/feed', { as: b })).body.events;
  await post('cheer/mute', a, { handle: b.handle, muted: true });
  await post('cheer', b, { eventId: event.id, emoji: '🔥' });
  assert.equal(outbox(a, 'cheerReceived').length, 0);
});

test('being invited to a challenge notifies the invitee', async () => {
  const a = await person('inv_a'), b = await person('inv_b'), off = await person('inv_c', { notify: {} });
  await friends(a, b); await friends(a, off);
  const r = await post('challenges', a, { title: 'Autumn push', type: 'sessions', mode: 'coop', target: 4, startDate: today(), endDate: iso(27), invite: [b.handle, off.handle] });
  assert.equal(r.status, 200);
  assert.equal(outbox(b, 'challengeInvite')[0].data.title, 'Autumn push');
  assert.equal(outbox(b, 'challengeInvite')[0].data.name, 'inv_a');
  assert.equal(outbox(off).length, 0);
});

test('a co-op challenge notifies everyone at halfway and again at the target, once each', async () => {
  const a = await person('mil_a'), b = await person('mil_b');
  await friends(a, b);
  const { body } = await post('challenges', a, { title: 'Together', type: 'sessions', mode: 'coop', target: 4, startDate: today(), endDate: iso(27), invite: [b.handle] });
  await post('challenges/join', b, { id: body.challenge.id });

  await save(a, [today()]);                                           // 1 of 4 sessions: 25 %
  assert.equal(outbox(b, 'challengeMilestone').length, 0);
  await save(b, [today()]);                                           // 2 of 4: halfway
  assert.deepEqual(outbox(a, 'challengeMilestone').map(i => i.data.stage), ['half']);
  assert.deepEqual(outbox(b, 'challengeMilestone').map(i => i.data.stage), ['half']);
  await save(b, [today()]);                                           // same state: nothing new
  assert.equal(outbox(a, 'challengeMilestone').length, 1);

  const ch = mod.db.challenges.find(c => c.id === body.challenge.id);
  ch.target = 2;                                                      // pretend the target is now reached
  await save(a, [today()]);
  assert.deepEqual(outbox(a, 'challengeMilestone').map(i => i.data.stage), ['half', 'target']);
});

test('finishing a challenge notifies each participant once, when maintenance runs', async () => {
  const a = await person('end_a'), b = await person('end_b');
  await friends(a, b);
  const { body } = await post('challenges', a, { title: 'Short one', type: 'sessions', mode: 'versus', target: 3, startDate: today(), endDate: iso(7), invite: [b.handle] });
  await post('challenges/join', b, { id: body.challenge.id });
  const delivered = user => mod.db.socialPushLog.filter(l => l.uid === user.id && l.kind === 'challengeEnded').length;
  await mod.runSocialMaintenance();
  assert.equal(delivered(a) + delivered(b), 0);                       // still running

  const ch = mod.db.challenges.find(c => c.id === body.challenge.id);
  ch.startDate = iso(-10); ch.endDate = iso(-1);
  await mod.runSocialMaintenance();
  await mod.runSocialMaintenance();
  assert.equal(delivered(a), 1);                                      // maintenance delivers what is due, once
  assert.equal(delivered(b), 1);
});

test('someone who stopped sharing is never notified', async () => {
  const a = await person('off_a'), b = await person('off_b');
  await friends(a, b);
  await app.request('/api/social/me', { method: 'PUT', as: b, body: { enabled: false } });
  await save(a, [today()]);
  assert.equal(outbox(b).length, 0);
});
