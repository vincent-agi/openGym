import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHEER_EMOJI, EVENT_TTL_DAYS, validateCheer, newEventsFromState, pruneFeed, countCheers } from '../feed.js';

const NOW = Date.parse('2026-10-07T10:00:00Z');
const session = (d, id = 'w' + d) => ({ id, d, entries: [{ id: 'x', sets: [{ done: true }] }] });

test('the cheer emoji set is small and fixed', () => {
  assert.deepEqual(CHEER_EMOJI, ['👏', '🔥', '💪', '🎉', '❤️']);
});

test('validateCheer accepts an event id and a whitelisted emoji, nothing else', () => {
  assert.deepEqual(validateCheer({ eventId: 'e1', emoji: '🔥' }), { ok: true, value: { eventId: 'e1', emoji: '🔥' } });
  for (const bad of [
    null, 'x', [], {}, { eventId: 'e1' }, { emoji: '🔥' }, { eventId: '', emoji: '🔥' },
    { eventId: 'e1', emoji: '🍕' }, { eventId: 'e1', emoji: 'hello' }, { eventId: 'e1', emoji: '🔥🔥' },
    { eventId: 'e1', emoji: '🔥', text: 'free text' }, { eventId: 5, emoji: '🔥' }
  ]) assert.equal(validateCheer(bad).ok, false, JSON.stringify(bad));
});

test('a new session in the last two days becomes an event, once', () => {
  const state = { workouts: [session('2026-10-07'), session('2026-10-06'), session('2026-10-02')] };
  const first = newEventsFromState(state, NOW, 'UTC', new Set());
  assert.deepEqual(first.map(e => e.date).sort(), ['2026-10-06', '2026-10-07']);   // 2 Oct is history, not news
  const seen = new Set(first.map(e => e.ref));
  assert.deepEqual(newEventsFromState(state, NOW, 'UTC', seen), []);
});

test('events carry no workout detail, only a date and an internal reference', () => {
  const [e] = newEventsFromState({ workouts: [session('2026-10-07', 'abc')] }, NOW, 'UTC', new Set());
  assert.deepEqual(Object.keys(e).sort(), ['date', 'ref']);
});

test('unfinished workouts, future dates and malformed states make no event', () => {
  const idle = { id: 'i', d: '2026-10-07', entries: [{ id: 'x', sets: [{ done: false }] }] };
  assert.deepEqual(newEventsFromState({ workouts: [idle, session('2026-10-09')] }, NOW, 'UTC', new Set()), []);
  for (const bad of [null, {}, { workouts: 'x' }]) assert.doesNotThrow(() => newEventsFromState(bad, NOW, 'UTC', new Set()));
});

test('workouts without an id still produce one event per day', () => {
  const state = { workouts: [{ d: '2026-10-07', entries: [{ sets: [{ done: true }] }] }] };
  const a = newEventsFromState(state, NOW, 'UTC', new Set());
  assert.equal(a.length, 1);
  assert.deepEqual(newEventsFromState(state, NOW, 'UTC', new Set(a.map(e => e.ref))), []);
});

test('pruneFeed drops events older than 30 days and the cheers that pointed at them', () => {
  assert.equal(EVENT_TTL_DAYS, 30);
  const day = 86400000;
  const events = [{ id: 'old', createdAt: NOW - 31 * day }, { id: 'new', createdAt: NOW - 1 * day }];
  const cheers = [{ eventId: 'old', from: 'a', emoji: '🔥' }, { eventId: 'new', from: 'a', emoji: '🔥' }];
  const r = pruneFeed(events, cheers, NOW);
  assert.deepEqual(r.events.map(e => e.id), ['new']);
  assert.deepEqual(r.cheers.map(c => c.eventId), ['new']);
});

test('countCheers groups by emoji in the whitelist order', () => {
  const list = [{ emoji: '🔥' }, { emoji: '👏' }, { emoji: '🔥' }];
  assert.deepEqual(countCheers(list), [{ emoji: '👏', count: 1 }, { emoji: '🔥', count: 2 }]);
  assert.deepEqual(countCheers([]), []);
});
