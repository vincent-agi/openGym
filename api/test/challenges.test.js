import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS, validateChallengeInput, collectProgress, progressOf, statusOf, challengeView, activeCountFor, removeParticipant, isStale
} from '../challenges.js';

const TODAY = '2026-10-07';   // Wednesday
const ok = input => validateChallengeInput(input, { today: TODAY });
const valid = { title: ' 4 weeks ', type: 'sessions', mode: 'versus', target: 12, startDate: '2026-10-07', endDate: '2026-11-03', invite: ['Marc', '@lea'] };

const session = d => ({ id: 'w' + d, d, entries: [{ id: 'x', sets: [{ done: true }] }] });
const state = (days, planned = []) => ({ routines: [{ id: 'r' }], week: Object.fromEntries(planned.map(d => [d, 'r'])), dayPlan: {}, workouts: days.map(session) });

test('a valid challenge is normalised', () => {
  const r = ok(valid);
  assert.equal(r.ok, true);
  assert.equal(r.value.title, '4 weeks');
  assert.deepEqual(r.value.invite, ['marc', 'lea']);
});

test('invalid challenges are rejected with a message', () => {
  const bad = patch => ok({ ...valid, ...patch });
  for (const [label, patch] of Object.entries({
    'empty title': { title: '  ' }, 'long title': { title: 'x'.repeat(LIMITS.titleMax + 1) },
    'unknown type': { type: 'weight' }, 'unknown mode': { mode: 'solo' },
    'zero target': { target: 0 }, 'fractional target': { target: 2.5 }, 'huge target': { target: 5000 },
    'start in the past': { startDate: '2026-10-01' }, 'bad date': { startDate: 'tomorrow' },
    'end before start': { endDate: '2026-10-06' },
    'too short': { endDate: '2026-10-12' }, 'too long': { endDate: '2027-01-30' },
    'nobody invited': { invite: [] }, 'too many invited': { invite: Array.from({ length: 12 }, (_, i) => 'friend' + i) }
  })) {
    const r = bad(patch);
    assert.equal(r.ok, false, label);
    assert.equal(typeof r.error, 'string', label);
  }
});

test('duration limits are inclusive: 7 and 90 days are fine', () => {
  assert.equal(ok({ ...valid, endDate: '2026-10-13' }).ok, true);    // 7 days
  assert.equal(ok({ ...valid, endDate: '2027-01-04' }).ok, true);    // 90 days
  assert.equal(ok({ ...valid, endDate: '2027-01-05' }).ok, false);   // 91 days
});

test('duplicate and own invitees are collapsed, unknown fields are rejected', () => {
  assert.deepEqual(ok({ ...valid, invite: ['marc', 'MARC', '@marc'] }).value.invite, ['marc']);
  assert.equal(ok({ ...valid, secret: 1 }).ok, false);
});

test('collectProgress counts sessions inside the window, per participant start', () => {
  const st = state(['2026-10-05', '2026-10-08', '2026-10-09', '2026-10-20']);
  const d = collectProgress(st, { from: '2026-10-08', to: '2026-10-31', today: '2026-10-21', gaps: [] });
  assert.equal(d.sessions, 3);                       // the 8th, 9th and 20th; the 5th is before the window
  assert.deepEqual(d.days, ['2026-10-08', '2026-10-09', '2026-10-20']);
});

test('collectProgress never counts the future or the end date overflow', () => {
  const st = state(['2026-10-07', '2026-10-09', '2026-11-30']);
  const d = collectProgress(st, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-07', gaps: [] });
  assert.deepEqual(d.days, ['2026-10-07']);
});

test('collectProgress skips days inside a pause', () => {
  const st = state(['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-09']);
  const d = collectProgress(st, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-10', gaps: [{ from: '2026-10-04', to: '2026-10-07' }] });
  assert.deepEqual(d.days, ['2026-10-02', '2026-10-09']);
});

test('collectProgress reports each week with its sessions, planned count and whether it is fully inside the window', () => {
  const st = state(['2026-10-06', '2026-10-13', '2026-10-14'], [1, 3]);
  const d = collectProgress(st, { from: '2026-10-05', to: '2026-10-25', today: '2026-10-20', gaps: [] });
  assert.deepEqual(d.weeks.map(w => [w.start, w.sessions, w.planned, w.full]), [
    ['2026-10-05', 1, 2, true], ['2026-10-12', 2, 2, true], ['2026-10-19', 0, 2, true]
  ]);
  const part = collectProgress(st, { from: '2026-10-07', to: '2026-10-25', today: '2026-10-20', gaps: [] });
  assert.equal(part.weeks[0].full, false);           // a late joiner never gets credit for a week they did not start
});

test('progressOf: sessions, active days, streak of weeks, weeks on plan', () => {
  const st = state(['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-27'], [1, 3]);
  const d = collectProgress(st, { from: '2026-10-05', to: '2026-11-01', today: '2026-11-01', gaps: [] });
  assert.equal(progressOf('sessions', d), 4);
  assert.equal(progressOf('activeDays', d), 4);
  assert.equal(progressOf('streak', d), 2);          // weeks of the 5th and 12th, then a gap, then the 26th alone
  assert.equal(progressOf('consistency', d), 1);     // only the first week reached its 2 planned sessions
});

test('statusOf follows the dates, the end date being inclusive, and cancellation wins', () => {
  const ch = { startDate: '2026-10-10', endDate: '2026-10-20', status: 'open' };
  assert.equal(statusOf(ch, '2026-10-09'), 'upcoming');
  assert.equal(statusOf(ch, '2026-10-10'), 'active');
  assert.equal(statusOf(ch, '2026-10-20'), 'active');
  assert.equal(statusOf(ch, '2026-10-21'), 'ended');
  assert.equal(statusOf({ ...ch, status: 'cancelled' }, '2026-10-15'), 'cancelled');
});

test('activeCountFor counts only live challenges the user is in', () => {
  const mk = (uid, pstatus, start, end, status = 'open') => ({ startDate: start, endDate: end, status, participants: [{ uid, status: pstatus }] });
  const list = [
    mk('u', 'joined', '2026-10-01', '2026-10-30'), mk('u', 'joined', '2026-11-01', '2026-11-30'),
    mk('u', 'left', '2026-10-01', '2026-10-30'), mk('u', 'invited', '2026-10-01', '2026-10-30'),
    mk('u', 'joined', '2026-09-01', '2026-09-30'), mk('u', 'joined', '2026-10-01', '2026-10-30', 'cancelled'), mk('other', 'joined', '2026-10-01', '2026-10-30')
  ];
  assert.equal(activeCountFor(list, 'u', TODAY), 2);
});

const people = { a: { handle: 'ana', displayName: 'Ana' }, b: { handle: 'bob', displayName: 'Bob' }, c: { handle: 'cy', displayName: 'Cy' } };
const base = (mode, extra = {}) => ({
  id: 'c1', title: 'T', type: 'sessions', mode, target: 10, startDate: '2026-10-01', endDate: '2026-10-31', status: 'open', ownerId: 'a',
  participants: [{ uid: 'a', status: 'joined' }, { uid: 'b', status: 'joined' }, { uid: 'c', status: 'invited' }], ...extra
});
const progress = { a: { sessions: 6, days: [], weeks: [] }, b: { sessions: 3, days: [], weeks: [] } };

test('versus view ranks joined participants by progress and shows invitees without a score', () => {
  const v = challengeView(base('versus'), { progress, people, isSharing: () => true, today: TODAY });
  assert.equal(v.status, 'active');
  assert.deepEqual(v.participants.map(p => [p.handle, p.current, p.position]), [['ana', 6, 1], ['bob', 3, 2], ['cy', null, null]]);
  assert.equal(v.participants[0].pct, 0.6);
  assert.equal(v.participants[2].state, 'invited');
  assert.equal(v.total, undefined);
});

test('versus ties share a position', () => {
  const v = challengeView(base('versus'), { progress: { a: { sessions: 4, days: [], weeks: [] }, b: { sessions: 4, days: [], weeks: [] } }, people, isSharing: () => true, today: TODAY });
  assert.deepEqual(v.participants.slice(0, 2).map(p => p.position), [1, 1]);
});

test('co-op view adds everyone together toward one shared target, with no individual ranking', () => {
  const v = challengeView(base('coop', { target: 12 }), { progress, people, isSharing: () => true, today: TODAY });
  assert.equal(v.total, 9);
  assert.equal(v.pct, 0.75);
  assert.equal(v.done, false);
  assert.ok(v.participants.every(p => p.position === null));
  const done = challengeView(base('coop', { target: 9 }), { progress, people, isSharing: () => true, today: TODAY });
  assert.equal(done.done, true);
  assert.equal(done.pct, 1);
});

test('someone who is not sharing is paused and does not count', () => {
  const v = challengeView(base('coop'), { progress, people, isSharing: uid => uid !== 'b', today: TODAY });
  assert.equal(v.total, 6);
  assert.equal(v.participants.find(p => p.handle === 'bob').state, 'paused');
});

test('people who left stay visible as left, uncounted and unranked', () => {
  const ch = base('versus'); ch.participants[1].status = 'left';
  const v = challengeView(ch, { progress, people, isSharing: () => true, today: TODAY });
  const bob = v.participants.find(p => p.handle === 'bob');
  assert.deepEqual([bob.state, bob.current, bob.position], ['left', null, null]);
  assert.deepEqual(v.participants.map(p => p.handle).slice(0, 1), ['ana']);
});

test('pct is capped at 1 and an ended challenge is reported as ended', () => {
  const v = challengeView(base('versus', { target: 4 }), { progress, people, isSharing: () => true, today: '2026-11-02' });
  assert.equal(v.status, 'ended');
  assert.equal(v.participants[0].pct, 1);
});

test('collectProgress honours planned breaks when counting planned sessions per week', () => {
  const st = { ...state(['2026-10-06'], [1, 3]), breaks: [{ from: '2026-10-05', to: '2026-10-11' }] };
  const d = collectProgress(st, { from: '2026-10-05', to: '2026-10-11', today: '2026-10-11', gaps: [] });
  assert.equal(d.weeks[0].planned, 0);
  assert.equal(progressOf('consistency', d), 0);      // a break week gives no credit, and no penalty
});

test('removeParticipant deletes the person and hands the challenge to someone still in', () => {
  const ch = { ownerId: 'a', status: 'open', participants: [{ uid: 'a', status: 'joined' }, { uid: 'b', status: 'invited' }, { uid: 'c', status: 'joined' }] };
  removeParticipant(ch, 'a');
  assert.deepEqual(ch.participants.map(p => p.uid), ['b', 'c']);
  assert.equal(ch.ownerId, 'c');
  assert.equal(ch.status, 'open');
});

test('removeParticipant cancels the challenge when nobody is left to own it', () => {
  const ch = { ownerId: 'a', status: 'open', participants: [{ uid: 'a', status: 'joined' }, { uid: 'b', status: 'invited' }] };
  removeParticipant(ch, 'a');
  assert.equal(ch.status, 'cancelled');
});

test('removeParticipant leaves the owner alone when someone else goes', () => {
  const ch = { ownerId: 'a', status: 'open', participants: [{ uid: 'a', status: 'joined' }, { uid: 'b', status: 'joined' }] };
  removeParticipant(ch, 'b');
  assert.equal(ch.ownerId, 'a');
  assert.deepEqual(ch.participants.map(p => p.uid), ['a']);
});

test('isStale: a challenge is forgotten 90 days after its end date, never before', () => {
  const ended = { startDate: '2026-01-01', endDate: '2026-02-01', status: 'open' };
  assert.equal(isStale(ended, '2026-05-01'), false);       // 89 days after the end
  assert.equal(isStale(ended, '2026-05-02'), true);        // 90 days after
  assert.equal(isStale({ ...ended, status: 'cancelled' }, '2026-05-02'), true);
  assert.equal(isStale({ startDate: '2026-09-01', endDate: '2026-12-01', status: 'open' }, '2027-06-01'), true);
  assert.equal(isStale({ startDate: '2026-09-01', endDate: '2027-12-01', status: 'open' }, '2027-06-01'), false);
});
