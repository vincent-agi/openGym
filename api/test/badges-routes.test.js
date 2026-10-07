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
const session = (d, id = 'w' + d) => ({ id, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const save = (user, workouts) => app.request('/api/data', { method: 'PUT', as: user, body: { state: { workouts } } });
const post = (path, as, body) => app.request('/api/social/' + path, { method: 'POST', as, body });
const me = as => app.request('/api/social/me', { as });
const put = (as, body) => app.request('/api/social/me', { method: 'PUT', as, body });

async function person(label) {
  const user = app.createUser(label);
  const handle = `${label}_${++seq}`;
  await put(user, { enabled: true, handle, displayName: label });
  return { ...user, handle };
}
async function friends(a, b) {
  await post('friends/request', a, { handle: b.handle });
  await post('friends/respond', b, { handle: a.handle, action: 'accept' });
}
const ids = body => body.social.earned.map(b => b.id).sort();

test('a new user has earned nothing and shows nothing', async () => {
  const user = await person('fresh');
  const { body } = await me(user);
  assert.deepEqual(body.social.earned, []);
  assert.deepEqual(body.social.showBadges, []);
  assert.ok(!('cheersSent' in body.social));
});

test('badges are earned from saved sessions and stay earned', async () => {
  const user = await person('earner');
  await save(user, [session(today()), session(iso(-1)), session(iso(-2))]);
  const first = (await me(user)).body;
  assert.ok(ids(first).includes('first-week'));
  assert.ok(ids(first).includes('hat-trick'));
  await save(user, []);                                              // history wiped: nothing is taken back
  assert.deepEqual(ids((await me(user)).body), ids(first));
});

test('the client cannot award itself a badge, or write the counters', async () => {
  const user = await person('cheat');
  for (const body of [{ earned: [{ id: 'hat-trick', date: today() }] }, { cheersSent: 99 }, { coopCompletedOn: today() }]) {
    assert.equal((await put(user, body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await me(user)).body.social.earned, []);
});

test('showBadges only accepts known badge ids, and friends see only what is chosen and earned', async () => {
  const a = await person('show_a'), b = await person('show_b');
  await friends(a, b);
  await save(a, [session(today()), session(iso(-1)), session(iso(-2))]);

  assert.deepEqual((await app.request('/api/social/friends/summary', { as: b })).body.friends[0].badges, []);   // default: none
  assert.equal((await put(a, { showBadges: ['nope'] })).status, 400);
  assert.equal((await put(a, { showBadges: ['hat-trick', 'cheerleader'] })).status, 200);                      // cheerleader not earned

  const shown = (await app.request('/api/social/friends/summary', { as: b })).body.friends[0].badges;
  assert.deepEqual(shown.map(x => x.id), ['hat-trick']);
  assert.match(shown[0].date, /^\d{4}-\d{2}-\d{2}$/);
});

test('strangers never see badges', async () => {
  const a = await person('str_a'), stranger = await person('str_b');
  await save(a, [session(today())]);
  await put(a, { showBadges: ['first-week'] });
  assert.deepEqual((await app.request('/api/social/friends/summary', { as: stranger })).body.friends, []);
});

test('sending ten cheers earns the Cheerleader badge', async () => {
  const a = await person('cheer_a'), b = await person('cheer_b');
  await friends(a, b);
  await save(a, Array.from({ length: 10 }, (_, i) => session(i % 2 ? iso(-1) : today(), 'w' + i)));
  const { events } = (await app.request('/api/social/feed', { as: b })).body;
  assert.equal(events.length, 10);
  for (const e of events.slice(0, 9)) await post('cheer', b, { eventId: e.id, emoji: '🔥' });
  assert.ok(!ids((await me(b)).body).includes('cheerleader'));
  await post('cheer', b, { eventId: events[9].id, emoji: '🔥' });
  assert.ok(ids((await me(b)).body).includes('cheerleader'));
});

test('changing a cheer does not count as a new one', async () => {
  const a = await person('chg_a'), b = await person('chg_b');
  await friends(a, b);
  await save(a, [session(today())]);
  const [event] = (await app.request('/api/social/feed', { as: b })).body.events;
  for (let i = 0; i < 12; i++) await post('cheer', b, { eventId: event.id, emoji: i % 2 ? '🔥' : '🎉' });
  assert.ok(!ids((await me(b)).body).includes('cheerleader'));
});

test('finishing a co-op challenge together earns Team player for everyone in it', async () => {
  const a = await person('team_a'), b = await person('team_b');
  await friends(a, b);
  const { body } = await post('challenges', a, { title: 'Together', type: 'sessions', mode: 'coop', target: 2, startDate: today(), endDate: iso(27), invite: [b.handle] });
  await post('challenges/join', b, { id: body.challenge.id });
  await save(a, [session(today())]); await save(b, [session(today())]);   // 2 of 2

  const ch = mod.db.challenges.find(c => c.id === body.challenge.id);
  ch.startDate = iso(-10); ch.endDate = iso(-1);
  await mod.runSocialMaintenance();
  assert.ok(ids((await me(a)).body).includes('team-player'));
  assert.ok(ids((await me(b)).body).includes('team-player'));
});

test('a co-op challenge that fell short earns nothing', async () => {
  const a = await person('short_a'), b = await person('short_b');
  await friends(a, b);
  const { body } = await post('challenges', a, { title: 'Too big', type: 'sessions', mode: 'coop', target: 50, startDate: today(), endDate: iso(27), invite: [b.handle] });
  await post('challenges/join', b, { id: body.challenge.id });
  const ch = mod.db.challenges.find(c => c.id === body.challenge.id);
  ch.startDate = iso(-10); ch.endDate = iso(-1);
  await mod.runSocialMaintenance();
  assert.ok(!ids((await me(a)).body).includes('team-player'));
});
