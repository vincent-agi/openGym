import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, clientIp, RULES } from '../rate-limit.js';

const clock = () => { const c = { t: 1_000_000 }; c.now = () => c.t; return c; };

test('allows up to the limit inside the window, then answers how long to wait', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 3, windowMs: 60_000 };
  for (let i = 0; i < 3; i++) assert.deepEqual(lim.check('k', rule), { ok: true });
  const blocked = lim.check('k', rule);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSec, 60);
});

test('the window slides: the oldest hit frees a slot when it ages out', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 2, windowMs: 60_000 };
  lim.check('k', rule); c.t += 30_000; lim.check('k', rule);
  assert.equal(lim.check('k', rule).ok, false);
  c.t += 31_000;                                         // the first hit is now 61 s old
  assert.equal(lim.check('k', rule).ok, true);
});

test('keys are independent', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 1, windowMs: 60_000 };
  assert.equal(lim.check('a', rule).ok, true);
  assert.equal(lim.check('b', rule).ok, true);
  assert.equal(lim.check('a', rule).ok, false);
});

test('a blocked attempt is not counted, so waiting out the window is enough', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 1, windowMs: 60_000 };
  lim.check('k', rule);
  for (let i = 0; i < 5; i++) lim.check('k', rule);
  c.t += 60_000;
  assert.equal(lim.check('k', rule).ok, true);
});

test('with backoff, every further attempt while blocked doubles the wait, up to the window', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 1, windowMs: 3_600_000, backoff: true };
  lim.check('k', rule);
  const waits = [];
  for (let i = 0; i < 8; i++) { waits.push(lim.check('k', rule).retryAfterSec); }
  assert.deepEqual(waits.slice(0, 4), [60, 120, 240, 480]);
  assert.equal(Math.max(...waits), 3600);
});

test('with backoff, waiting out the lock lets the person try again', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 1, windowMs: 3_600_000, backoff: true };
  lim.check('k', rule);
  const { retryAfterSec } = lim.check('k', rule);
  c.t += retryAfterSec * 1000 + 3_600_000;
  assert.equal(lim.check('k', rule).ok, true);
});

test('checkAll needs every key to pass and counts the hit on all of them', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  const rule = { limit: 2, windowMs: 60_000 };
  assert.equal(lim.checkAll(['u:1', 'ip:x'], rule).ok, true);
  assert.equal(lim.checkAll(['u:2', 'ip:x'], rule).ok, true);
  assert.equal(lim.checkAll(['u:3', 'ip:x'], rule).ok, false);     // the shared address ran out
  assert.equal(lim.checkAll(['u:1', 'ip:y'], rule).ok, true);      // same person, other address
});

test('old entries are forgotten so memory does not grow', () => {
  const c = clock(); const lim = createLimiter({ now: c.now });
  for (let i = 0; i < 100; i++) lim.check('k' + i, { limit: 1, windowMs: 1000 });
  assert.equal(lim.size(), 100);
  c.t += 5000; lim.prune();
  assert.equal(lim.size(), 0);
});

test('the rules match what the milestone promises', () => {
  assert.deepEqual(RULES.friendRequest, { limit: 10, windowMs: 3_600_000 });
  assert.deepEqual(RULES.friendCode, { limit: 20, windowMs: 3_600_000, backoff: true });
  assert.deepEqual(RULES.cheer, { limit: 60, windowMs: 3_600_000 });
  assert.deepEqual(RULES.challengeCreate, { limit: 10, windowMs: 86_400_000 });
});

test('clientIp trusts the address nginx sets, not the client-supplied forwarding chain', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }, socket: { remoteAddress: '10.0.0.2' } }), '203.0.113.7');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '10.0.0.2' } }), '10.0.0.2');
  assert.equal(clientIp({ headers: {}, socket: {} }), 'unknown');
});
