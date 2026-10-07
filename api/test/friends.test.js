import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRIEND_CODE_ALPHABET, FRIEND_CODE_LENGTH, generateFriendCode, isCodeUsable,
  sendRequest, respondToRequest, removeFriend, blockUser, unblockUser, relationsOf
} from '../friends.js';

const NOW = Date.parse('2026-10-07T10:00:00Z');
const make = () => [];

test('friend codes use an unambiguous alphabet and a fixed length', () => {
  for (const ch of '0O1IL') assert.ok(!FRIEND_CODE_ALPHABET.includes(ch), `${ch} must not be in the alphabet`);
  const code = generateFriendCode();
  assert.equal(code.length, FRIEND_CODE_LENGTH);
  assert.ok([...code].every(c => FRIEND_CODE_ALPHABET.includes(c)));
});

test('friend codes are not repeated', () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateFriendCode()));
  assert.equal(codes.size, 200);
});

test('isCodeUsable rejects expired and revoked codes', () => {
  const live = { code: 'ABC', uid: 'u', expiresAt: NOW + 1000 };
  assert.equal(isCodeUsable(live, NOW), true);
  assert.equal(isCodeUsable({ ...live, expiresAt: NOW - 1 }, NOW), false);
  assert.equal(isCodeUsable({ ...live, revoked: true }, NOW), false);
  assert.equal(isCodeUsable(undefined, NOW), false);
});

test('sendRequest creates one pending request', () => {
  const list = make();
  const r = sendRequest(list, 'a', 'b', NOW);
  assert.equal(r.ok, true);
  assert.equal(list.length, 1);
  assert.deepEqual({ status: list[0].status, by: list[0].requestedBy }, { status: 'pending', by: 'a' });
});

test('a pair is stored once, in a canonical order', () => {
  const list = make();
  sendRequest(list, 'z', 'a', NOW);
  assert.deepEqual([list[0].a, list[0].b], ['a', 'z']);
});

test('requests to yourself, duplicates and existing friends all fail the same way', () => {
  const list = make();
  const self = sendRequest(list, 'a', 'a', NOW);
  sendRequest(list, 'a', 'b', NOW);
  const dup = sendRequest(list, 'a', 'b', NOW);
  respondToRequest(list, 'b', 'a', 'accept', NOW);
  const friends = sendRequest(list, 'a', 'b', NOW);
  for (const r of [self, dup, friends]) assert.deepEqual(r, { ok: false });
});

test('a request toward someone who already asked you completes the friendship', () => {
  const list = make();
  sendRequest(list, 'a', 'b', NOW);
  const r = sendRequest(list, 'b', 'a', NOW);
  assert.equal(r.ok, true);
  assert.equal(list[0].status, 'accepted');
});

test('requests involving a block fail the same way, whoever blocked', () => {
  const list = make();
  blockUser(list, 'a', 'b', NOW);
  assert.deepEqual(sendRequest(list, 'a', 'b', NOW), { ok: false });
  assert.deepEqual(sendRequest(list, 'b', 'a', NOW), { ok: false });
});

test('only the recipient can accept, and accepting records the date', () => {
  const list = make();
  sendRequest(list, 'a', 'b', NOW);
  assert.deepEqual(respondToRequest(list, 'a', 'b', 'accept', NOW), { ok: false });
  assert.equal(respondToRequest(list, 'b', 'a', 'accept', NOW + 5).ok, true);
  assert.equal(list[0].status, 'accepted');
  assert.equal(list[0].since, NOW + 5);
});

test('declining deletes the request so it can be sent again later', () => {
  const list = make();
  sendRequest(list, 'a', 'b', NOW);
  assert.equal(respondToRequest(list, 'b', 'a', 'decline', NOW).ok, true);
  assert.equal(list.length, 0);
  assert.equal(sendRequest(list, 'a', 'b', NOW).ok, true);
});

test('respondToRequest needs an action it knows', () => {
  const list = make();
  sendRequest(list, 'a', 'b', NOW);
  assert.deepEqual(respondToRequest(list, 'b', 'a', 'maybe', NOW), { ok: false });
});

test('removeFriend deletes an accepted friendship from either side', () => {
  const list = make();
  sendRequest(list, 'a', 'b', NOW);
  respondToRequest(list, 'b', 'a', 'accept', NOW);
  assert.equal(removeFriend(list, 'b', 'a').ok, true);
  assert.equal(list.length, 0);
  assert.deepEqual(removeFriend(list, 'a', 'b'), { ok: false });
});

test('removeFriend does not touch pending requests or blocks', () => {
  const list = make();
  sendRequest(list, 'a', 'b', NOW);
  assert.deepEqual(removeFriend(list, 'a', 'b'), { ok: false });
  assert.equal(list.length, 1);
});

test('blockUser works on strangers, friends and pending requests, and records who blocked', () => {
  const list = make();
  assert.equal(blockUser(list, 'a', 'b', NOW).ok, true);
  assert.equal(list[0].status, 'blocked');
  assert.equal(list[0].blockedBy, 'a');

  const friends = make();
  sendRequest(friends, 'a', 'b', NOW);
  respondToRequest(friends, 'b', 'a', 'accept', NOW);
  blockUser(friends, 'b', 'a', NOW);
  assert.deepEqual({ s: friends[0].status, by: friends[0].blockedBy }, { s: 'blocked', by: 'b' });
});

test('blocking someone who already blocked you changes nothing', () => {
  const list = make();
  blockUser(list, 'a', 'b', NOW);
  blockUser(list, 'b', 'a', NOW);
  assert.equal(list[0].blockedBy, 'a');
});

test('only the blocker can unblock', () => {
  const list = make();
  blockUser(list, 'a', 'b', NOW);
  assert.deepEqual(unblockUser(list, 'b', 'a'), { ok: false });
  assert.equal(unblockUser(list, 'a', 'b').ok, true);
  assert.equal(list.length, 0);
});

test('relationsOf lists friends and pending requests from the caller point of view', () => {
  const list = make();
  sendRequest(list, 'me', 'f1', NOW);  respondToRequest(list, 'f1', 'me', 'accept', NOW);
  sendRequest(list, 'f2', 'me', NOW);                       // incoming
  sendRequest(list, 'me', 'f3', NOW);                       // outgoing
  blockUser(list, 'me', 'f4', NOW);                         // I blocked
  blockUser(list, 'f5', 'me', NOW);                         // they blocked me
  const r = relationsOf(list, 'me');
  assert.deepEqual(r.friends.map(f => f.uid), ['f1']);
  assert.deepEqual(r.incoming.map(f => f.uid), ['f2']);
  assert.deepEqual(r.outgoing.map(f => f.uid), ['f3']);
  assert.deepEqual(r.blocked.map(f => f.uid), ['f4']);
});

test('relationsOf never reveals that someone blocked you', () => {
  const list = make();
  blockUser(list, 'f5', 'me', NOW);
  const r = relationsOf(list, 'me');
  assert.deepEqual(r, { friends: [], incoming: [], outgoing: [], blocked: [] });
});
