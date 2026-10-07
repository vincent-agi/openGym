import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGES, evaluateBadges, CHEERLEADER_AT, mergeEarned, validateShowBadges } from '../badges.js';

const NOW = Date.parse('2026-10-07T10:00:00Z');          // Wednesday; this week starts Monday 5 Oct
const session = d => ({ id: 'w' + d, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const st = (days, extra = {}) => ({ workouts: days.map(session), ...extra });
const earned = (state, facts) => Object.fromEntries(evaluateBadges(state, NOW, 'UTC', facts).map(b => [b.id, b.date]));

test('the catalogue is fixed and none of the badges is about strength, size or rank', () => {
  assert.deepEqual(BADGES, ['first-week', 'hat-trick', 'four-in-a-row', 'back-on-track', 'team-player', 'cheerleader']);
  for (const id of BADGES) assert.ok(!/weight|kg|rank|first-place|winner|best/i.test(id), id);
});

test('nothing is earned without a session', () => {
  assert.deepEqual(evaluateBadges({}, NOW, 'UTC', {}), []);
  assert.deepEqual(evaluateBadges(null, NOW, 'UTC'), []);
});

test('first week: the first session, dated that day', () => {
  assert.deepEqual(earned(st(['2026-09-30', '2026-10-06'])), { 'first-week': '2026-09-30' });
});

test('hat-trick: three sessions in one calendar week, dated the third', () => {
  const r = earned(st(['2026-09-28', '2026-09-29', '2026-10-06', '2026-10-07', '2026-09-30']));
  assert.equal(r['hat-trick'], '2026-09-30');
  assert.equal(earned(st(['2026-09-28', '2026-09-29']))['hat-trick'], undefined);
  assert.equal(earned(st(['2026-09-27', '2026-09-28', '2026-09-29']))['hat-trick'], undefined);   // Sunday belongs to the week before
});

test('four in a row: four consecutive weeks with a session, dated the fourth week first session', () => {
  const r = earned(st(['2026-09-14', '2026-09-23', '2026-09-30', '2026-10-06']));
  assert.equal(r['four-in-a-row'], '2026-10-06');
  assert.equal(earned(st(['2026-09-14', '2026-09-23', '2026-10-06']))['four-in-a-row'], undefined);
});

test('back on track: a session right after a missed week', () => {
  const r = earned(st(['2026-09-08', '2026-09-22']));          // nothing in the week of 14 Sep
  assert.equal(r['back-on-track'], '2026-09-22');
  assert.equal(earned(st(['2026-09-08', '2026-09-15']))['back-on-track'], undefined);
});

test('back on track: a session within a week of a planned break ending', () => {
  const state = st(['2026-09-08', '2026-09-24'], { breaks: [{ from: '2026-09-14', to: '2026-09-20' }] });
  assert.equal(earned(state)['back-on-track'], '2026-09-24');
  const later = st(['2026-09-08', '2026-10-06'], { breaks: [{ from: '2026-09-14', to: '2026-09-20' }] });
  assert.equal(earned(later)['back-on-track'], '2026-10-06');   // still a missed stretch in between, so the week rule awards it then
});

test('team player and cheerleader come from social facts, not from training', () => {
  assert.equal(earned(st([]), { coopCompletedOn: '2026-10-01' })['team-player'], '2026-10-01');
  assert.equal(CHEERLEADER_AT, 10);
  assert.equal(earned(st([]), { cheersSent: 9 })['cheerleader'], undefined);
  assert.equal(earned(st([]), { cheersSent: 10 })['cheerleader'], '2026-10-07');
});

test('weight, effort and body data never change what is earned', () => {
  const a = earned(st(['2026-10-05', '2026-10-06', '2026-10-07']));
  const b = earned({ ...st(['2026-10-05', '2026-10-06', '2026-10-07']), bodyweight: [{ w: 300 }], mobilityLevel: 'wheelchair' });
  assert.deepEqual(a, b);
});

test('sessions dated in the future do not earn anything', () => {
  assert.deepEqual(earned(st(['2026-10-09', '2026-10-10', '2026-10-11'])), {});
});

test('mergeEarned only ever adds, keeping the date of the first time', () => {
  const have = [{ id: 'first-week', date: '2026-09-01' }];
  const merged = mergeEarned(have, [{ id: 'first-week', date: '2026-09-30' }, { id: 'hat-trick', date: '2026-10-01' }]);
  assert.deepEqual(merged.list, [{ id: 'first-week', date: '2026-09-01' }, { id: 'hat-trick', date: '2026-10-01' }]);
  assert.deepEqual(merged.added, ['hat-trick']);
  assert.deepEqual(mergeEarned(merged.list, []).added, []);
  assert.deepEqual(have, [{ id: 'first-week', date: '2026-09-01' }]);   // input untouched
});

test('validateShowBadges accepts a list of known badge ids', () => {
  assert.deepEqual(validateShowBadges(['hat-trick', 'hat-trick', 'first-week']), { ok: true, value: ['hat-trick', 'first-week'] });
  assert.equal(validateShowBadges([]).ok, true);
  for (const bad of ['x', null, ['nope'], [1], { a: 1 }]) assert.equal(validateShowBadges(bad).ok, false, JSON.stringify(bad));
});
