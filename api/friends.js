/**
 * Friend graph of the Gymme social module: codes, requests, acceptance, removal and blocking.
 *
 * The state transitions are pure functions over a plain array of friendship records so they
 * can be unit tested without HTTP. {@link createFriendRoutes} adapts them to the API.
 *
 * Two privacy rules shape every function here:
 * - **No enumeration.** Every refusal a stranger could use to probe the instance (unknown
 *   user, not sharing, blocked, duplicate) returns the same bare `{ ok: false }`.
 * - **Blocks are silent.** The blocked party never learns they were blocked.
 */
import crypto from 'node:crypto';
import { isSharing } from './social.js';

/** Letters and digits without the look-alikes `0 O 1 I L`, so a code survives being read aloud. */
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Number of characters in a friend code (about 49 bits). */
export const FRIEND_CODE_LENGTH = 10;

/** How long a freshly generated friend code stays usable. */
export const FRIEND_CODE_TTL_DAYS = 14;

/**
 * @typedef {'pending' | 'accepted' | 'blocked'} FriendshipStatus
 */
/**
 * One record per pair of users, whatever the direction.
 *
 * @typedef {object} Friendship
 * @property {string} id            Opaque record id.
 * @property {string} a             Lower user id of the pair.
 * @property {string} b             Higher user id of the pair.
 * @property {FriendshipStatus} status
 * @property {string} requestedBy   User who sent the request (pending/accepted records).
 * @property {number} createdAt     Epoch ms.
 * @property {number} [since]       Epoch ms the friendship was accepted.
 * @property {string} [blockedBy]   User who blocked (blocked records only).
 */
/**
 * @typedef {object} FriendCode
 * @property {string} code        The shareable code.
 * @property {string} uid         Owner of the code.
 * @property {number} createdAt   Epoch ms.
 * @property {number} expiresAt   Epoch ms after which the code is refused.
 * @property {boolean} [revoked]  Set when the owner rotates their code.
 */

/** @typedef {{ok: true, friendship: Friendship} | {ok: false}} Outcome */
const FAIL = Object.freeze({ ok: false });

/**
 * Generates a random friend code.
 *
 * @returns {string}
 */
export function generateFriendCode() {
  let out = '';
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) out += FRIEND_CODE_ALPHABET[crypto.randomInt(FRIEND_CODE_ALPHABET.length)];
  return out;
}

/**
 * Whether a code can still be redeemed.
 *
 * @param {FriendCode | undefined} entry
 * @param {number} now  Epoch ms.
 * @returns {boolean}
 */
export function isCodeUsable(entry, now) {
  return !!entry && !entry.revoked && entry.expiresAt > now;
}

/** @param {Friendship[]} list @param {string} x @param {string} y @returns {Friendship | undefined} */
const find = (list, x, y) => {
  const [a, b] = x < y ? [x, y] : [y, x];
  return list.find(f => f.a === a && f.b === b);
};

/** @param {Friendship[]} list @param {Friendship} rec */
const drop = (list, rec) => { list.splice(list.indexOf(rec), 1); };

/**
 * Sends a friend request. When the other person already asked you, the two requests meet
 * and the friendship is accepted.
 *
 * @param {Friendship[]} list  Friendship store, mutated in place.
 * @param {string} from  Requesting user id.
 * @param {string} to    Target user id.
 * @param {number} now   Epoch ms.
 * @returns {Outcome}
 */
export function sendRequest(list, from, to, now) {
  if (from === to) return FAIL;
  const existing = find(list, from, to);
  if (!existing) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const friendship = {
      id: crypto.randomBytes(6).toString('base64url'), a, b, status: 'pending', requestedBy: from, createdAt: now
    };
    list.push(friendship);
    return { ok: true, friendship };
  }
  if (existing.status === 'pending' && existing.requestedBy !== from) {
    existing.status = 'accepted';
    existing.since = now;
    return { ok: true, friendship: existing };
  }
  return FAIL;
}

/**
 * Answers a pending request addressed to `uid`.
 *
 * @param {Friendship[]} list
 * @param {string} uid        User answering; must be the recipient.
 * @param {string} requester  User who asked.
 * @param {'accept' | 'decline'} action  Declining deletes the record so a new request can be sent later.
 * @param {number} now
 * @returns {Outcome}
 */
export function respondToRequest(list, uid, requester, action, now) {
  const rec = find(list, uid, requester);
  if (!rec || rec.status !== 'pending' || rec.requestedBy !== requester) return FAIL;
  if (action === 'accept') { rec.status = 'accepted'; rec.since = now; return { ok: true, friendship: rec }; }
  if (action === 'decline') { drop(list, rec); return { ok: true, friendship: rec }; }
  return FAIL;
}

/**
 * Ends an accepted friendship, from either side.
 *
 * @param {Friendship[]} list
 * @param {string} uid
 * @param {string} other
 * @returns {Outcome}
 */
export function removeFriend(list, uid, other) {
  const rec = find(list, uid, other);
  if (!rec || rec.status !== 'accepted') return FAIL;
  drop(list, rec);
  return { ok: true, friendship: rec };
}

/**
 * Blocks someone: they can no longer find, invite or see the blocker. Works on strangers,
 * pending requests and existing friends. Blocking a user who already blocked you changes nothing.
 *
 * @param {Friendship[]} list
 * @param {string} by      Blocker.
 * @param {string} target  Blocked user.
 * @param {number} now
 * @returns {Outcome}
 */
export function blockUser(list, by, target, now) {
  if (by === target) return FAIL;
  const rec = find(list, by, target);
  if (rec?.status === 'blocked') return rec.blockedBy === by ? { ok: true, friendship: rec } : FAIL;
  if (rec) {
    rec.status = 'blocked'; rec.blockedBy = by; delete rec.since;
    return { ok: true, friendship: rec };
  }
  const [a, b] = by < target ? [by, target] : [target, by];
  const friendship = {
    id: crypto.randomBytes(6).toString('base64url'), a, b, status: 'blocked', requestedBy: by, blockedBy: by, createdAt: now
  };
  list.push(friendship);
  return { ok: true, friendship };
}

/**
 * Lifts a block. Only the blocker can.
 *
 * @param {Friendship[]} list
 * @param {string} by
 * @param {string} target
 * @returns {Outcome}
 */
export function unblockUser(list, by, target) {
  const rec = find(list, by, target);
  if (!rec || rec.status !== 'blocked' || rec.blockedBy !== by) return FAIL;
  drop(list, rec);
  return { ok: true, friendship: rec };
}

/**
 * @typedef {object} Relation
 * @property {string} uid     The other user.
 * @property {number} [since] When the friendship was accepted.
 */
/**
 * Everything one user is allowed to know about their own relationships. Blocks made *against*
 * them are deliberately absent.
 *
 * @param {Friendship[]} list
 * @param {string} uid
 * @returns {{friends: Relation[], incoming: Relation[], outgoing: Relation[], blocked: Relation[]}}
 */
export function relationsOf(list, uid) {
  const out = { friends: [], incoming: [], outgoing: [], blocked: [] };
  for (const f of list) {
    if (f.a !== uid && f.b !== uid) continue;
    const other = f.a === uid ? f.b : f.a;
    if (f.status === 'accepted') out.friends.push({ uid: other, since: f.since });
    else if (f.status === 'pending') (f.requestedBy === uid ? out.outgoing : out.incoming).push({ uid: other });
    else if (f.blockedBy === uid) out.blocked.push({ uid: other });
  }
  return out;
}

/** The answer to every request that cannot be honoured, whatever the reason. */
const NOBODY = 'nobody can be added with that code or handle';

/**
 * Builds the `/api/social/friends*` route table.
 *
 * @param {object} ctx
 * @param {{users: object[], friendships: Friendship[], friendCodes: FriendCode[]}} ctx.db  Identity store.
 * @param {() => void} ctx.saveDb
 * @param {(req: import('node:http').IncomingMessage) => (object | null)} ctx.readSession
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} ctx.json
 * @param {(req: import('node:http').IncomingMessage) => Promise<any>} ctx.readBody
 * @param {() => number} [ctx.now]  Clock, injectable for tests.
 * @returns {Record<string, Function>}
 */
export function createFriendRoutes({ db, saveDb, readSession, json, readBody, now = Date.now }) {
  const byId = id => db.users.find(u => u.id === id);
  const byHandle = handle => db.users.find(u => u.social?.handle === String(handle || '').trim().replace(/^@/, '').toLowerCase());
  const card = (id, extra = {}) => { const u = byId(id); return { handle: u.social.handle, displayName: u.social.displayName, ...extra }; };

  /** Resolves the caller, who must be signed in and sharing. Answers the error itself. */
  const caller = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    if (!isSharing(user)) { json(res, 403, { error: 'turn on sharing first' }); return null; }
    return user;
  };

  /** Wraps an action on an existing relationship identified by `{handle}`. */
  const onHandle = action => async (req, res) => {
    const user = caller(req, res);
    if (!user) return;
    const body = await readBody(req);
    const other = byHandle(body.handle);
    const result = other ? action(user, other, body) : FAIL;
    if (!result.ok) return json(res, 404, { error: 'not found' });
    saveDb();
    json(res, 200, { ok: true });
  };

  return {
    'POST /api/social/friends/code': async (req, res) => {
      const user = caller(req, res);
      if (!user) return;
      const t = now();
      for (const c of db.friendCodes) if (c.uid === user.id) c.revoked = true;
      db.friendCodes = db.friendCodes.filter(c => !c.revoked || c.uid !== user.id);
      const entry = { code: generateFriendCode(), uid: user.id, createdAt: t, expiresAt: t + FRIEND_CODE_TTL_DAYS * 86400000 };
      db.friendCodes.push(entry);
      saveDb();
      json(res, 200, { code: entry.code, expiresAt: entry.expiresAt });
    },

    'GET /api/social/friends': async (req, res) => {
      const user = caller(req, res);
      if (!user) return;
      const rel = relationsOf(db.friendships, user.id);
      const visible = list => list.filter(r => isSharing(byId(r.uid)));
      json(res, 200, {
        friends: visible(rel.friends).map(r => card(r.uid, { since: r.since })),
        incoming: visible(rel.incoming).map(r => card(r.uid)),
        outgoing: visible(rel.outgoing).map(r => card(r.uid)),
        blocked: rel.blocked.map(r => ({ handle: byId(r.uid)?.social?.handle || '' })).filter(b => b.handle)
      });
    },

    'POST /api/social/friends/request': async (req, res) => {
      const user = caller(req, res);
      if (!user) return;
      const body = await readBody(req);
      let target;
      if (typeof body.code === 'string' && body.code) {
        const entry = db.friendCodes.find(c => c.code === body.code.trim().toUpperCase());
        target = isCodeUsable(entry, now()) ? byId(entry.uid) : null;
      } else target = byHandle(body.handle);
      const result = target && isSharing(target) ? sendRequest(db.friendships, user.id, target.id, now()) : FAIL;
      if (!result.ok) return json(res, 404, { error: NOBODY });
      saveDb();
      json(res, 200, { status: result.friendship.status, friend: card(target.id) });
    },

    'POST /api/social/friends/respond': onHandle((user, other, body) =>
      respondToRequest(db.friendships, user.id, other.id, body.action, now())),

    'POST /api/social/friends/remove': onHandle((user, other) => removeFriend(db.friendships, user.id, other.id)),

    'POST /api/social/friends/unblock': onHandle((user, other) => unblockUser(db.friendships, user.id, other.id)),

    // Blocking an unknown handle succeeds as a no-op, so the answer cannot be used to probe handles.
    'POST /api/social/friends/block': async (req, res) => {
      const user = caller(req, res);
      if (!user) return;
      const other = byHandle((await readBody(req)).handle);
      if (other) { blockUser(db.friendships, user.id, other.id, now()); saveDb(); }
      json(res, 200, { ok: true });
    }
  };
}
