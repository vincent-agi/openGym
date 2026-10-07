import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSocial, normalizeHandle, validateSocialUpdate, isSharing } from '../social.js';

const taken = new Set(['marc']);
const opts = { isHandleTaken: h => taken.has(h) };

test('defaultSocial is fully private', () => {
  const d = defaultSocial();
  assert.equal(d.enabled, false);
  assert.equal(d.handle, '');
  assert.equal(d.displayName, '');
  assert.equal(d.hideRank, false);
  assert.deepEqual(d.share, { sessions: true, streak: true, consistency: true, prs: false });
  assert.equal(d.notify.friendSession, false);
  assert.deepEqual(d.notify.quiet, { from: '21:00', to: '08:00' });
});

test('defaultSocial returns a fresh object each time', () => {
  const a = defaultSocial();
  a.share.prs = true;
  assert.equal(defaultSocial().share.prs, false);
});

test('normalizeHandle trims, lowercases and strips a leading @', () => {
  assert.equal(normalizeHandle('  @Léa_Fit '), 'léa_fit');
  assert.equal(normalizeHandle('@Marc'), 'marc');
  assert.equal(normalizeHandle(42), '');
});

test('a valid update is merged onto the current settings', () => {
  const r = validateSocialUpdate({ handle: 'Lea_92', displayName: ' Léa ', hideRank: true }, defaultSocial(), opts);
  assert.equal(r.ok, true);
  assert.equal(r.value.handle, 'lea_92');
  assert.equal(r.value.displayName, 'Léa');
  assert.equal(r.value.hideRank, true);
  assert.equal(r.value.enabled, false);
});

test('handles must be 3-20 chars of a-z 0-9 _', () => {
  for (const bad of ['ab', 'a'.repeat(21), 'has space', 'dash-ed', 'émile', '']) {
    const r = validateSocialUpdate({ handle: bad }, defaultSocial(), opts);
    assert.equal(r.ok, false, `expected "${bad}" to be rejected`);
    assert.equal(r.status, 400);
  }
});

test('a handle already used by someone else is a conflict', () => {
  const r = validateSocialUpdate({ handle: 'Marc' }, defaultSocial(), opts);
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('keeping your own handle is not a conflict', () => {
  const current = { ...defaultSocial(), handle: 'marc' };
  const r = validateSocialUpdate({ handle: 'marc' }, current, { isHandleTaken: () => false });
  assert.equal(r.ok, true);
});

test('display name is 1-30 chars without control characters', () => {
  for (const bad of ['', '   ', 'x'.repeat(31), 'bad\u0007name', 'new\nline', 7]) {
    const r = validateSocialUpdate({ displayName: bad }, defaultSocial(), opts);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('sharing cannot be enabled without a handle and a display name', () => {
  const r = validateSocialUpdate({ enabled: true }, defaultSocial(), opts);
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('sharing can be enabled once handle and display name are set', () => {
  const r = validateSocialUpdate({ enabled: true, handle: 'lea', displayName: 'Léa' }, defaultSocial(), opts);
  assert.equal(r.ok, true);
  assert.equal(r.value.enabled, true);
});

test('sharing can always be switched off, even from an incomplete record', () => {
  const r = validateSocialUpdate({ enabled: false }, { ...defaultSocial(), enabled: true }, opts);
  assert.equal(r.ok, true);
  assert.equal(r.value.enabled, false);
});

test('share flags merge key by key and must be booleans', () => {
  const ok = validateSocialUpdate({ share: { prs: true } }, defaultSocial(), opts);
  assert.deepEqual(ok.value.share, { sessions: true, streak: true, consistency: true, prs: true });
  assert.equal(validateSocialUpdate({ share: { prs: 'yes' } }, defaultSocial(), opts).ok, false);
});

test('unknown fields are rejected so nothing unreviewed is ever stored', () => {
  assert.equal(validateSocialUpdate({ weight: 80 }, defaultSocial(), opts).ok, false);
  assert.equal(validateSocialUpdate({ share: { weight: true } }, defaultSocial(), opts).ok, false);
});

test('a non-object payload is rejected', () => {
  for (const bad of [null, 'x', 3, []]) assert.equal(validateSocialUpdate(bad, defaultSocial(), opts).ok, false);
});

test('validation does not mutate the current settings', () => {
  const current = defaultSocial();
  validateSocialUpdate({ handle: 'lea', share: { prs: true } }, current, opts);
  assert.deepEqual(current, defaultSocial());
});

test('isSharing is true only for a user who explicitly enabled sharing', () => {
  assert.equal(isSharing({ id: 'a' }), false);
  assert.equal(isSharing({ id: 'a', social: defaultSocial() }), false);
  assert.equal(isSharing({ id: 'a', social: { ...defaultSocial(), enabled: true } }), true);
  assert.equal(isSharing(null), false);
});

test('notification preferences are validated and merged through the same update', () => {
  const r = validateSocialUpdate({ notify: { cheerReceived: true, quiet: { from: '22:30' } } }, defaultSocial(), opts);
  assert.equal(r.ok, true);
  assert.equal(r.value.notify.cheerReceived, true);
  assert.deepEqual(r.value.notify.quiet, { from: '22:30', to: '08:00' });
  assert.equal(validateSocialUpdate({ notify: { sms: true } }, defaultSocial(), opts).ok, false);
  assert.equal(validateSocialUpdate({ notify: { quiet: { from: 'night' } } }, defaultSocial(), opts).ok, false);
});
