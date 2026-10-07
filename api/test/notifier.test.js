import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, wording, localMinutes, DAILY_CAP, BATCH_MS, MAX_DEFER_MS } from '../notifier.js';
import { defaultNotify } from '../notify-prefs.js';

const at = iso => Date.parse(iso);
const HOUR = 3600000;

/** A recipient who opted in to everything, unless overridden. */
function recipient(over = {}) {
  const notify = { ...defaultNotify(), friendSession: true, cheerReceived: true, challengeInvite: true, challengeMilestone: true, challengeEnded: true };
  return { id: 'r', social: { enabled: true, handle: 'rae', displayName: 'Rae', share: {}, notify, ...over } };
}

function setup({ user = recipient(), subscribed = true, tz = 'UTC', start = '2026-10-07T12:00:00Z' } = {}) {
  const clock = { t: at(start) };
  const sent = [];
  const db = { users: [user], subs: subscribed ? [{ userId: user.id }] : [], socialOutbox: [], socialPushLog: [] };
  const n = createNotifier({
    db, saveDb() {}, now: () => clock.t,
    sendPush: async (uid, payload) => { sent.push({ uid, ...payload }); },
    readState: () => ({ reminder: { tz } })
  });
  return { n, db, sent, clock, user };
}
const advance = async (ctx, ms) => { ctx.clock.t += ms; await ctx.n.flush(); };

test('nothing is sent unless the user opted in to that kind', async () => {
  const ctx = setup({ user: recipient({ notify: defaultNotify() }) });
  assert.equal(await ctx.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' }), false);
  await ctx.n.flush();
  assert.equal(ctx.sent.length, 0);
});

test('nothing is sent to someone who is not sharing, or has no subscription', async () => {
  const quiet = setup({ user: recipient({ enabled: false }) });
  assert.equal(await quiet.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' }), false);
  const unsubscribed = setup({ subscribed: false });
  assert.equal(await unsubscribed.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' }), false);
  assert.equal(quiet.sent.length + unsubscribed.sent.length, 0);
  assert.equal(await setup().n.notify('nobody', 'cheerReceived', {}), false);
});

test('a cheer is delivered at once, with a deep link and a friendly message', async () => {
  const ctx = setup();
  await ctx.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' });
  await ctx.n.flush();
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].title, 'Lea cheered your session 🔥');
  assert.equal(ctx.sent[0].url, '#/crew');
});

test('a friend session waits a few minutes, so several friends become one digest', async () => {
  const ctx = setup();
  await ctx.n.notify('r', 'friendSession', { name: 'Lea' });
  await ctx.n.flush();
  assert.equal(ctx.sent.length, 0);                      // still inside the batching window
  await advance(ctx, 2 * 60000);
  await ctx.n.notify('r', 'friendSession', { name: 'Marc' });
  await advance(ctx, BATCH_MS);
  assert.equal(ctx.sent.length, 1);
  assert.equal(ctx.sent[0].title, '2 friends trained today');
});

test('a single friend is named', async () => {
  const ctx = setup();
  await ctx.n.notify('r', 'friendSession', { name: 'Lea' });
  await advance(ctx, BATCH_MS);
  assert.equal(ctx.sent[0].title, 'Lea finished a session');
});

test('only one friend-session push per day, whoever trains next', async () => {
  const ctx = setup();
  await ctx.n.notify('r', 'friendSession', { name: 'Lea' });
  await advance(ctx, BATCH_MS);
  await ctx.n.notify('r', 'friendSession', { name: 'Marc' });
  await advance(ctx, BATCH_MS);
  assert.equal(ctx.sent.length, 1);
  await advance(ctx, 24 * HOUR);                          // a new day
  await ctx.n.notify('r', 'friendSession', { name: 'Marc' });
  await advance(ctx, BATCH_MS);
  assert.equal(ctx.sent.length, 2);
});

test('no more than three social pushes a day in total', async () => {
  const ctx = setup();
  assert.equal(DAILY_CAP, 3);
  for (let i = 0; i < 5; i++) { await ctx.n.notify('r', 'cheerReceived', { name: 'F' + i, emoji: '👏' }); await ctx.n.flush(); }
  assert.equal(ctx.sent.length, 3);
});

test('during quiet hours a push is held and delivered when they end', async () => {
  const ctx = setup({ start: '2026-10-07T22:00:00Z' });
  await ctx.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' });
  await ctx.n.flush();
  assert.equal(ctx.sent.length, 0);
  await advance(ctx, 5 * HOUR);                           // 03:00, still quiet
  assert.equal(ctx.sent.length, 0);
  await advance(ctx, 5 * HOUR);                           // 08:00
  assert.equal(ctx.sent.length, 1);
});

test('quiet hours follow the recipient time zone, not the server', async () => {
  const ctx = setup({ tz: 'Asia/Tokyo', start: '2026-10-07T12:00:00Z' });   // 21:00 in Tokyo
  assert.equal(localMinutes(ctx.clock.t, 'Asia/Tokyo'), 21 * 60);
  await ctx.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' });
  await ctx.n.flush();
  assert.equal(ctx.sent.length, 0);
});

test('a push held for more than twelve hours is dropped, not delivered stale', async () => {
  const user = recipient(); user.social.notify.quiet = { from: '21:00', to: '10:00' };   // 13 hours of quiet
  const ctx = setup({ user, start: '2026-10-07T21:00:00Z' });
  assert.ok(13 * HOUR > MAX_DEFER_MS);
  await ctx.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' });
  await advance(ctx, 13 * HOUR);
  assert.equal(ctx.sent.length, 0);
  assert.equal(ctx.db.socialOutbox.length, 0);
});

test('turning a preference off drops what was waiting for it', async () => {
  const ctx = setup();
  await ctx.n.notify('r', 'friendSession', { name: 'Lea' });
  ctx.user.social.notify.friendSession = false;
  await advance(ctx, BATCH_MS);
  assert.equal(ctx.sent.length, 0);
});

test('every message is encouraging: no ranks, no comparisons, no "behind"', () => {
  const samples = [
    wording('friendSession', { names: ['Lea'] }), wording('friendSession', { names: ['Lea', 'Marc', 'Zoe'] }),
    wording('cheerReceived', { name: 'Lea', emoji: '👏' }), wording('challengeInvite', { name: 'Lea', title: 'Autumn push' }),
    wording('challengeMilestone', { title: 'Autumn push', stage: 'half' }), wording('challengeMilestone', { title: 'Autumn push', stage: 'target' }),
    wording('challengeEnded', { title: 'Autumn push' })
  ];
  for (const m of samples) {
    const text = `${m.title} ${m.body}`.toLowerCase();
    for (const bad of ['behind', 'beat', 'lost', 'last place', 'rank', 'worse', 'lazy', 'miss']) assert.ok(!text.includes(bad), `${bad} in "${text}"`);
    assert.equal(m.url, '#/crew');
    assert.ok(m.tag && m.title && m.body);
  }
});

test('the outbox never keeps more than what is waiting', async () => {
  const ctx = setup();
  await ctx.n.notify('r', 'cheerReceived', { name: 'Lea', emoji: '🔥' });
  await ctx.n.flush();
  assert.equal(ctx.db.socialOutbox.length, 0);
  assert.equal(ctx.db.socialPushLog.length, 1);
});
