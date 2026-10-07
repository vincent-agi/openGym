import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTIFY_KINDS, defaultNotify, validateNotify, minutesOf, inQuietHours, minutesUntilQuietEnds
} from '../notify-prefs.js';

test('every kind of notification is off by default, with quiet hours at night', () => {
  const d = defaultNotify();
  assert.deepEqual(NOTIFY_KINDS, ['friendSession', 'cheerReceived', 'challengeInvite', 'challengeMilestone', 'challengeEnded']);
  for (const k of NOTIFY_KINDS) assert.equal(d[k], false, k);
  assert.deepEqual(d.quiet, { from: '21:00', to: '08:00' });
});

test('defaults are a fresh object each time', () => {
  const a = defaultNotify(); a.quiet.from = '00:00'; a.friendSession = true;
  assert.deepEqual(defaultNotify(), { ...defaultNotify() });
  assert.equal(defaultNotify().friendSession, false);
});

test('a partial update merges onto the current preferences', () => {
  const r = validateNotify({ friendSession: true, quiet: { to: '07:30' } }, defaultNotify());
  assert.equal(r.ok, true);
  assert.equal(r.value.friendSession, true);
  assert.deepEqual(r.value.quiet, { from: '21:00', to: '07:30' });
  assert.equal(r.value.cheerReceived, false);
});

test('only booleans and HH:MM times are accepted, and unknown fields are refused', () => {
  const cur = defaultNotify();
  for (const bad of [null, 'x', [], { friendSession: 'yes' }, { quiet: 'night' }, { quiet: { from: '25:00' } }, { quiet: { from: '9:00' } },
    { quiet: { from: '21:00', extra: 1 } }, { sms: true }, { quiet: { to: '12:60' } }]) {
    assert.equal(validateNotify(bad, cur).ok, false, JSON.stringify(bad));
  }
});

test('validation does not mutate the current preferences', () => {
  const cur = defaultNotify();
  validateNotify({ friendSession: true, quiet: { from: '22:00' } }, cur);
  assert.deepEqual(cur, defaultNotify());
});

test('minutesOf reads HH:MM', () => {
  assert.equal(minutesOf('00:00'), 0);
  assert.equal(minutesOf('08:30'), 510);
  assert.equal(minutesOf('23:59'), 1439);
});

test('quiet hours can span midnight, or sit inside a day', () => {
  const night = { from: '21:00', to: '08:00' };
  assert.equal(inQuietHours(night, minutesOf('22:00')), true);
  assert.equal(inQuietHours(night, minutesOf('03:00')), true);
  assert.equal(inQuietHours(night, minutesOf('08:00')), false);   // the end is the first minute you may be disturbed
  assert.equal(inQuietHours(night, minutesOf('12:00')), false);
  assert.equal(inQuietHours(night, minutesOf('21:00')), true);
  const nap = { from: '13:00', to: '14:00' };
  assert.equal(inQuietHours(nap, minutesOf('13:30')), true);
  assert.equal(inQuietHours(nap, minutesOf('14:00')), false);
  assert.equal(inQuietHours({ from: '09:00', to: '09:00' }, minutesOf('09:00')), false);   // an empty window is no quiet time
});

test('minutesUntilQuietEnds counts to the end of the window, across midnight', () => {
  const night = { from: '21:00', to: '08:00' };
  assert.equal(minutesUntilQuietEnds(night, minutesOf('23:00')), 9 * 60);
  assert.equal(minutesUntilQuietEnds(night, minutesOf('07:30')), 30);
  assert.equal(minutesUntilQuietEnds(night, minutesOf('21:00')), 11 * 60);
});
