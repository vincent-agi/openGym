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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isSharing, requireSharing } from './social.ts';
import type { FriendCode, Friendship, FriendshipStatus, Services, SocialHooks, User, Db, Routes, Route } from './types.ts';

export type { FriendCode, Friendship, FriendshipStatus };

/** Letters and digits without the look-alikes `0 O 1 I L`, so a code survives being read aloud. */
export const FRIEND_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Number of characters in a friend code (about 49 bits). */
export const FRIEND_CODE_LENGTH = 10;

/** How long a freshly generated friend code stays usable. */
export const FRIEND_CODE_TTL_DAYS = 14;

/** The result of changing a relationship: the record concerned, or the one bare failure every refusal shares. */
export type Outcome = { ok: true; friendship: Friendship } | { ok: false };
const FAIL: Outcome = Object.freeze({ ok: false });

/**
 * Generates a random friend code.
 *
 */
export function generateFriendCode(): string {
  let out = '';
  for (let i = 0; i < FRIEND_CODE_LENGTH; i++) out += FRIEND_CODE_ALPHABET[crypto.randomInt(FRIEND_CODE_ALPHABET.length)];
  return out;
}

/**
 * Drops friend codes that expired more than a day ago. Newly expired ones stay a little so a
 * "that code expired" message is still possible.
 *
 * @param codes  Not modified.
 * @param now  Epoch ms.
 */
export function pruneFriendCodes(codes: FriendCode[], now: number): FriendCode[] {
  return codes.filter(c => c.expiresAt > now - 86400000);
}

/**
 * Whether a code can still be redeemed.
 *
 * @param entry
 * @param now  Epoch ms.
 */
export function isCodeUsable(entry: FriendCode | undefined, now: number): boolean {
  return !!entry && !entry.revoked && entry.expiresAt > now;
}

const find = (list: Friendship[], x: string, y: string): Friendship | undefined => {
  const [a, b] = x < y ? [x, y] : [y, x];
  return list.find(f => f.a === a && f.b === b);
};

const drop = (list: Friendship[], rec: Friendship): void => { list.splice(list.indexOf(rec), 1); };

/**
 * Sends a friend request. When the other person already asked you, the two requests meet
 * and the friendship is accepted.
 *
 * @param list  Friendship store, mutated in place.
 * @param from  Requesting user id.
 * @param to    Target user id.
 * @param now   Epoch ms.
 */
export function sendRequest(list: Friendship[], from: string, to: string, now: number): Outcome {
  if (from === to) return FAIL;
  const existing = find(list, from, to);
  if (!existing) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const friendship: Friendship = {
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
 * @param list
 * @param uid        User answering; must be the recipient.
 * @param requester  User who asked.
 * @param action     Declining deletes the record so a new request can be sent later; anything else is refused.
 * @param now
 */
export function respondToRequest(list: Friendship[], uid: string, requester: string, action: unknown, now: number): Outcome {
  const rec = find(list, uid, requester);
  if (!rec || rec.status !== 'pending' || rec.requestedBy !== requester) return FAIL;
  if (action === 'accept') { rec.status = 'accepted'; rec.since = now; return { ok: true, friendship: rec }; }
  if (action === 'decline') { drop(list, rec); return { ok: true, friendship: rec }; }
  return FAIL;
}

/**
 * Ends an accepted friendship, from either side.
 *
 * @param list
 * @param uid
 * @param other
 */
export function removeFriend(list: Friendship[], uid: string, other: string): Outcome {
  const rec = find(list, uid, other);
  if (!rec || rec.status !== 'accepted') return FAIL;
  drop(list, rec);
  return { ok: true, friendship: rec };
}

/**
 * Blocks someone: they can no longer find, invite or see the blocker. Works on strangers,
 * pending requests and existing friends. Blocking a user who already blocked you changes nothing.
 *
 * @param list
 * @param by      Blocker.
 * @param target  Blocked user.
 * @param now
 */
export function blockUser(list: Friendship[], by: string, target: string, now: number): Outcome {
  if (by === target) return FAIL;
  const rec = find(list, by, target);
  if (rec?.status === 'blocked') return rec.blockedBy === by ? { ok: true, friendship: rec } : FAIL;
  if (rec) {
    rec.status = 'blocked'; rec.blockedBy = by; delete rec.since;
    return { ok: true, friendship: rec };
  }
  const [a, b] = by < target ? [by, target] : [target, by];
  const friendship: Friendship = {
    id: crypto.randomBytes(6).toString('base64url'), a, b, status: 'blocked', requestedBy: by, blockedBy: by, createdAt: now
  };
  list.push(friendship);
  return { ok: true, friendship };
}

/**
 * Lifts a block. Only the blocker can.
 *
 * @param list
 * @param by
 * @param target
 */
export function unblockUser(list: Friendship[], by: string, target: string): Outcome {
  const rec = find(list, by, target);
  if (!rec || rec.status !== 'blocked' || rec.blockedBy !== by) return FAIL;
  drop(list, rec);
  return { ok: true, friendship: rec };
}

/** The other side of a relationship; `since` is when a friendship was accepted. */
export interface Relation { uid: string; since?: number }

/** What {@link relationsOf} returns. */
export interface Relations { friends: Relation[]; incoming: Relation[]; outgoing: Relation[]; blocked: Relation[] }

/**
 * Everything one user is allowed to know about their own relationships. Blocks made *against*
 * them are deliberately absent.
 *
 * @param list
 * @param uid
 */
export function relationsOf(list: Friendship[], uid: string): Relations {
  const out: Relations = { friends: [], incoming: [], outgoing: [], blocked: [] };
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

/** What {@link createFriendRoutes} needs from the server. */
export interface FriendRouteDeps extends Pick<Services, 'saveDb' | 'readSession' | 'json' | 'readBody'> {
  db: Pick<Db, 'users' | 'friendships' | 'friendCodes'>
  now?: () => number
  guard?: NonNullable<SocialHooks['guard']>
  onSever?: NonNullable<SocialHooks['onSever']>
}

/**
 * Builds the `/api/social/friends*` route table.
 *
 * @param ctx  Server services. `now` is the clock (injectable for tests), `guard` the rate-limit
 *   guard (true when the action may proceed), and `onSever` is called when a friendship ends
 *   (removed or blocked), so anything shared between the two can be cleaned up.
 */
export function createFriendRoutes({ db, saveDb, readSession, json, readBody, now = Date.now, guard = () => true, onSever = () => {} }: FriendRouteDeps): Routes {
  const byId = (id: string) => db.users.find(u => u.id === id);
  const byHandle = (handle: unknown) => db.users.find(u => u.social?.handle === String(handle || '').trim().replace(/^@/, '').toLowerCase());
  /** A user who is sharing, as friends see them. Callers only pass ids of users with a handle. */
  const card = (id: string, extra: Record<string, unknown> = {}) => { const u = byId(id)!; return { handle: u.social!.handle, displayName: u.social!.displayName, ...extra }; };

  const caller = (req: IncomingMessage, res: ServerResponse) => requireSharing(readSession, json, req, res);
  // A body that parses to `null` or a primitive is not rejected yet, and reading a field of it throws; #60 closes that gap.
  const fieldsOf = (body: unknown) => body as Record<string, unknown>;

  /** Wraps an action on an existing relationship identified by `{handle}`. */
  const onHandle = (action: (user: User, other: User, body: Record<string, unknown>) => Outcome): Route => async (req, res) => {
    const user = caller(req, res);
    if (!user) return;
    const body = fieldsOf(await readBody(req));
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
      const visible = (list: Relation[]) => list.filter(r => isSharing(byId(r.uid)));
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
      const body = fieldsOf(await readBody(req));
      const code = typeof body.code === 'string' && body.code ? body.code : null;
      if (!guard(code ? 'friendCode' : 'friendRequest', req, res, user)) return;
      let target: User | null | undefined;
      if (code) {
        const entry = db.friendCodes.find(c => c.code === code.trim().toUpperCase());
        target = entry && isCodeUsable(entry, now()) ? byId(entry.uid) : null;
      } else target = byHandle(body.handle);
      if (!target || !isSharing(target)) return json(res, 404, { error: NOBODY });
      const result = sendRequest(db.friendships, user.id, target.id, now());
      if (!result.ok) return json(res, 404, { error: NOBODY });
      saveDb();
      json(res, 200, { status: result.friendship.status, friend: card(target.id) });
    },

    'POST /api/social/friends/respond': onHandle((user, other, body) =>
      respondToRequest(db.friendships, user.id, other.id, body.action, now())),

    'POST /api/social/friends/remove': onHandle((user, other) => {
      const result = removeFriend(db.friendships, user.id, other.id);
      if (result.ok) onSever(user.id, other.id);
      return result;
    }),

    'POST /api/social/friends/unblock': onHandle((user, other) => unblockUser(db.friendships, user.id, other.id)),

    // Blocking an unknown handle succeeds as a no-op, so the answer cannot be used to probe handles.
    'POST /api/social/friends/block': async (req, res) => {
      const user = caller(req, res);
      if (!user) return;
      const other = byHandle(fieldsOf(await readBody(req)).handle);
      if (other) { blockUser(db.friendships, user.id, other.id, now()); onSever(user.id, other.id); saveDb(); }
      json(res, 200, { ok: true });
    }
  };
}
