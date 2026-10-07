import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_KEYS, computeSummary, filterSummary, isoInZone, mondayOf, addDays } from '../summary.js';

// Wednesday 7 Oct 2026, 10:00 UTC. Weeks start on Monday: this week is 2026-10-05 .. 2026-10-11.
const NOW = Date.parse('2026-10-07T10:00:00Z');

/** A finished workout on `d`; `done` controls whether any set was actually completed. */
const workout = (d, { done = true, prs } = {}) => ({
  id: 'w' + d, d, entries: [{ id: '0025', sets: [{ w: 50, r: 5, done }, { w: 50, r: 5, done: false }] }], ...(prs ? { prs } : {})
});
/** State with routine ids planned on the given weekdays (0 = Sunday). */
const state = ({ workouts = [], planned = [], dayPlan = {} } = {}) => ({
  routines: [{ id: 'r1', name: 'Push' }, { id: 'r2', name: 'Pull' }],
  week: Object.fromEntries(planned.map(d => [d, 'r1'])),
  dayPlan, workouts
});

test('date helpers: Monday of a week, day arithmetic, local date in a zone', () => {
  assert.equal(mondayOf('2026-10-07'), '2026-10-05');
  assert.equal(mondayOf('2026-10-05'), '2026-10-05');
  assert.equal(mondayOf('2026-10-11'), '2026-10-05');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(isoInZone(Date.parse('2026-10-25T23:30:00Z'), 'UTC'), '2026-10-25');
  assert.equal(isoInZone(Date.parse('2026-10-25T23:30:00Z'), 'Europe/Paris'), '2026-10-26');
  assert.equal(isoInZone(NOW, 'Not/AZone'), '2026-10-07');
});

test('an empty profile gives an empty summary', () => {
  const s = computeSummary(state(), NOW, 'UTC');
  assert.deepEqual(s, {
    weekSessions: 0, weekPlanned: 0, weekConsistency: null, monthSessions: 0,
    streakWeeks: 0, activeDays: [], lastActiveDate: null, prCount: 0
  });
});

test('the summary has exactly the whitelisted keys, nothing else', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-06')], planned: [1, 3, 5] }), NOW, 'UTC');
  assert.deepEqual(Object.keys(s).sort(), [...SUMMARY_KEYS].sort());
});

test('only workouts with at least one completed set count as sessions', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-06'), workout('2026-10-07', { done: false })] }), NOW, 'UTC');
  assert.equal(s.weekSessions, 1);
  assert.deepEqual(s.activeDays, ['2026-10-06']);
});

test('week and month counts follow the calendar, the week starting on Monday', () => {
  const workouts = ['2026-10-04', '2026-10-05', '2026-10-07', '2026-10-01', '2026-09-30'].map(d => workout(d));
  const s = computeSummary(state({ workouts }), NOW, 'UTC');
  assert.equal(s.weekSessions, 2);     // 5th and 7th; Sunday the 4th belongs to the previous week
  assert.equal(s.monthSessions, 4);    // 1st, 4th, 5th, 7th; 30 Sept is last month
});

test('sessions dated after today are ignored, so a hand-edited state cannot inflate a score', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-09'), workout('2027-01-01'), workout('2026-10-06')] }), NOW, 'UTC');
  assert.equal(s.weekSessions, 1);
  assert.equal(s.monthSessions, 1);
  assert.deepEqual(s.activeDays, ['2026-10-06']);
});

test('consistency is completed sessions over the user own plan, capped at 100%', () => {
  const planned = [1, 3, 5];
  const two = computeSummary(state({ planned, workouts: [workout('2026-10-05'), workout('2026-10-07')] }), NOW, 'UTC');
  assert.equal(two.weekPlanned, 3);
  assert.equal(two.weekConsistency, 0.67);
  const extra = computeSummary(state({ planned: [1], workouts: [workout('2026-10-05'), workout('2026-10-06'), workout('2026-10-07')] }), NOW, 'UTC');
  assert.equal(extra.weekConsistency, 1);
});

test('nothing planned means no consistency figure, not zero', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-06')] }), NOW, 'UTC');
  assert.equal(s.weekPlanned, 0);
  assert.equal(s.weekConsistency, null);
});

test('a rescheduled day counts as planned on its new date, a skipped one disappears', () => {
  const base = { planned: [1, 3], workouts: [workout('2026-10-06')] };   // Mon + Wed planned, trained on Tuesday
  assert.equal(computeSummary(state(base), NOW, 'UTC').weekPlanned, 2);
  const moved = state({ ...base, dayPlan: { '2026-10-07': 'rest', '2026-10-06': 'r2' } });
  const s = computeSummary(moved, NOW, 'UTC');
  assert.equal(s.weekPlanned, 2);          // Wednesday removed, Tuesday added
  assert.equal(s.weekConsistency, 0.5);
  const sick = state({ planned: [1, 3], dayPlan: { '2026-10-05': 'rest', '2026-10-07': 'rest' } });
  assert.equal(computeSummary(sick, NOW, 'UTC').weekPlanned, 0);
});

test('an override pointing at a deleted routine falls back to the weekly plan', () => {
  const s = computeSummary(state({ planned: [1], dayPlan: { '2026-10-05': 'gone' } }), NOW, 'UTC');
  assert.equal(s.weekPlanned, 1);
});

test('streak counts consecutive weeks with a session, ending this week or last week', () => {
  const thisWeek = ['2026-10-06', '2026-09-30', '2026-09-23'].map(d => workout(d));
  assert.equal(computeSummary(state({ workouts: thisWeek }), NOW, 'UTC').streakWeeks, 3);
  const notYet = ['2026-09-30', '2026-09-23'].map(d => workout(d));   // nothing yet this week: the streak is not broken
  assert.equal(computeSummary(state({ workouts: notYet }), NOW, 'UTC').streakWeeks, 2);
  const gap = ['2026-10-06', '2026-09-23'].map(d => workout(d));      // missed the week of 28 Sep
  assert.equal(computeSummary(state({ workouts: gap }), NOW, 'UTC').streakWeeks, 1);
});

test('active days cover the last 28 days only, sorted and unique, with no other detail', () => {
  const workouts = ['2026-10-06', '2026-10-06', '2026-09-10', '2026-09-09', '2026-10-01'].map((d, i) => ({ ...workout(d), id: 'x' + i }));
  const s = computeSummary(state({ workouts }), NOW, 'UTC');
  assert.deepEqual(s.activeDays, ['2026-09-10', '2026-10-01', '2026-10-06']);   // 2026-09-09 is 28 days back: outside the window
  assert.equal(s.lastActiveDate, '2026-10-06');
});

test('personal records are counted over the same 28 days', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-06', { prs: ['0025', '0047'] }), workout('2026-08-01', { prs: ['x'] })] }), NOW, 'UTC');
  assert.equal(s.prCount, 2);
});

test('"today" follows the owner time zone, so week boundaries do not shift', () => {
  const late = Date.parse('2026-10-25T23:30:00Z');   // Sunday in UTC, already Monday 26th in Paris (clocks went back that night)
  const w = [workout('2026-10-26')];
  assert.equal(computeSummary(state({ workouts: w }), late, 'UTC').weekSessions, 0);
  assert.equal(computeSummary(state({ workouts: w }), late, 'Europe/Paris').weekSessions, 1);
});

test('nothing but the state fields it understands is read, and the state is not modified', () => {
  const st = state({ workouts: [workout('2026-10-06')], planned: [1] });
  st.bodyweight = [{ d: '2026-10-06', w: 99 }]; st.nutrition = { log: { x: 1 } }; st.mobilityLevel = 'wheelchair';
  const before = JSON.stringify(st);
  const s = computeSummary(st, NOW, 'UTC');
  assert.equal(JSON.stringify(st), before);
  assert.ok(!JSON.stringify(s).includes('99'));
  assert.ok(!JSON.stringify(s).includes('wheelchair'));
});

test('malformed states do not throw', () => {
  for (const bad of [null, {}, { workouts: 'x' }, { workouts: [null, { d: 'nope' }, { d: '2026-10-06' }] }]) {
    assert.doesNotThrow(() => computeSummary(bad, NOW, 'UTC'));
  }
});

test('filterSummary drops what the user chose not to share', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-06', { prs: ['a'] })], planned: [1] }), NOW, 'UTC');
  const all = filterSummary(s, { sessions: true, streak: true, consistency: true, prs: true });
  assert.ok('weekSessions' in all && 'streakWeeks' in all && 'weekConsistency' in all && 'prCount' in all);
  const none = filterSummary(s, { sessions: false, streak: false, consistency: false, prs: false });
  assert.deepEqual(none, {});
  const onlyStreak = filterSummary(s, { sessions: false, streak: true, consistency: false, prs: false });
  assert.deepEqual(Object.keys(onlyStreak), ['streakWeeks']);
});

test('active days and last active date travel with the sessions choice', () => {
  const s = computeSummary(state({ workouts: [workout('2026-10-06')] }), NOW, 'UTC');
  const f = filterSummary(s, { sessions: true, streak: false, consistency: false, prs: false });
  assert.deepEqual(Object.keys(f).sort(), ['activeDays', 'lastActiveDate', 'monthSessions', 'weekSessions']);
});
