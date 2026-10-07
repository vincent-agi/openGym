/**
 * Storage and HTTP for the activity feed and cheers. Rules live in `feed.ts`.
 *
 * Events are created on the server whenever a sharing user saves their state, so nobody can
 * post one for somebody else; friends only ever receive a date, a name and emoji.
 */
import crypto from 'node:crypto';
import { isSharing, requireSharing } from './social.ts';
import type { SharingUser } from './social.ts';
import { ownerTz } from './summary.ts';
import { relationsOf } from './friends.ts';
import { bodyFields } from './types.ts';
import type { FeedResponse } from '../shared/social.ts';
import type { Routes, Services, SocialEvent, SocialHooks, StateDoc, User } from './types.ts';
import { validateCheer, newEventsFromState, pruneFeed, countCheers } from './feed.ts';

/** Events returned per page of the feed. */
export const PAGE_SIZE = 30;

/** Own recent sessions listed with the cheers they received. */
const MINE_COUNT = 5;

/** What the feed service hands back to the composition root. */
export interface FeedService {
  /** Records an event for each new completed session; returns the events created, so the caller can tell friends. */
  recordEvents: (user: User, state: StateDoc) => SocialEvent[]
  /** Removes every cheer between two people, in both directions. Called when a friendship ends. */
  onSever: (a: string, b: string) => void
  routes: Routes
}

/**
 * @param ctx  `notify` is the push notifier (the default does nothing), `guard` the rate-limit guard,
 *   `onNewCheer` is called when someone sends a cheer for the first time on an event.
 */
export function createFeedService({ db, saveDb, readSession, json, readBody, notify = async () => false, onNewCheer = () => {}, guard = () => true, now = Date.now }:
  Pick<Services, 'db' | 'saveDb' | 'readSession' | 'json' | 'readBody'> & Pick<SocialHooks, 'notify' | 'guard' | 'onNewCheer'> & { now?: () => number }): FeedService {
  const userById = (id: string) => db.users.find(u => u.id === id);
  const friendIds = (uid: string) => new Set(relationsOf(db.friendships, uid).friends.map(f => f.uid));
  /** An owner whose sessions friends may see. */
  const visible = (u: User | undefined): u is SharingUser => isSharing(u) && u.social.share.sessions;
  const isMuted = (uid: string, mutedUid: string) => db.cheerMutes.some(m => m.uid === uid && m.mutedUid === mutedUid);

  /**
   * Records an event for each new completed session of a user who shares sessions.
   *
   * @param user
   * @param state  The state just saved.
   * @returns The events created, so the caller can tell friends. Empty when none.
   */
  const recordEvents = (user: User, state: StateDoc): SocialEvent[] => {
    if (!visible(user)) return [];
    try {
      const t = now();
      const seen = new Set(db.socialEvents.filter(e => e.uid === user.id).map(e => e.ref));
      const fresh = newEventsFromState(state, t, ownerTz(state), seen);
      if (!fresh.length) return [];
      const created: SocialEvent[] = fresh.map(f => ({ id: crypto.randomBytes(8).toString('base64url'), uid: user.id, ref: f.ref, date: f.date, kind: 'session', createdAt: t }));
      db.socialEvents.push(...created);
      const kept = pruneFeed(db.socialEvents, db.socialCheers, t);
      db.socialEvents = kept.events;
      db.socialCheers = kept.cheers;
      saveDb();
      return created;
    } catch (e) { console.error('feed events failed for', user.id, e); return []; }
  };

  /** Removes every cheer between two people, in both directions. Called when a friendship ends. */
  const onSever = (a: string, b: string): void => {
    const owner = (id: string) => db.socialEvents.find(e => e.id === id)?.uid;
    const before = db.socialCheers.length;
    db.socialCheers = db.socialCheers.filter(c => !((c.from === a && owner(c.eventId) === b) || (c.from === b && owner(c.eventId) === a)));
    if (db.socialCheers.length !== before) saveDb();
  };

  const cheersOn = (eventId: string) => db.socialCheers.filter(c => c.eventId === eventId);

  const routes: Routes = {
    'GET /api/social/feed': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const before = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('before')) || Infinity;
      const friends = friendIds(user.id);

      const events = db.socialEvents
        .filter(e => friends.has(e.uid) && visible(userById(e.uid)) && e.createdAt < before)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, PAGE_SIZE)
        .map(e => {
          const owner = userById(e.uid)!.social!;   // `visible` above proved the owner exists and has settings
          const cheers = cheersOn(e.id);
          return {
            id: e.id, handle: owner.handle, displayName: owner.displayName, date: e.date, createdAt: e.createdAt,
            cheers: countCheers(cheers), myCheer: cheers.find(c => c.from === user.id)?.emoji ?? null
          };
        });

      const mine = db.socialEvents
        .filter(e => e.uid === user.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MINE_COUNT)
        .map(e => {
          const heard = cheersOn(e.id).filter(c => friends.has(c.from) && !isMuted(user.id, c.from));
          return {
            id: e.id, date: e.date, createdAt: e.createdAt, cheers: countCheers(heard),
            from: heard.map(c => ({ emoji: c.emoji, displayName: userById(c.from)?.social?.displayName || '' }))
          };
        });
      const muted = db.cheerMutes.filter(m => m.uid === user.id && friends.has(m.mutedUid)).map(m => userById(m.mutedUid)?.social?.handle).filter((h): h is string => !!h);
      const answer: FeedResponse = { events, mine, muted };
      json(res, 200, answer);
    },

    'POST /api/social/cheer': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user || !guard('cheer', req, res, user)) return;
      const checked = validateCheer(await readBody(req));
      if (!checked.ok) return json(res, 400, { error: 'send an event id and one of the cheer emoji' });
      const { eventId, emoji } = checked.value;
      const event = db.socialEvents.find(e => e.id === eventId);
      if (!event || event.uid === user.id || !friendIds(user.id).has(event.uid) || !visible(userById(event.uid))) {
        return json(res, 404, { error: 'not found' });
      }
      const existing = db.socialCheers.find(c => c.eventId === eventId && c.from === user.id);
      if (existing) existing.emoji = emoji;
      else {
        db.socialCheers.push({ eventId, from: user.id, emoji, createdAt: now() });
        onNewCheer(user);
        if (!isMuted(event.uid, user.id)) notify(event.uid, 'cheerReceived', { name: user.social.displayName, emoji });
      }
      saveDb();
      json(res, 200, { ok: true });
    },

    'POST /api/social/cheer/retract': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const { eventId } = bodyFields(await readBody(req));
      db.socialCheers = db.socialCheers.filter(c => !(c.eventId === eventId && c.from === user.id));
      saveDb();
      json(res, 200, { ok: true });
    },

    'POST /api/social/cheer/mute': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const { handle, muted } = bodyFields(await readBody(req));
      const other = db.users.find(u => u.social?.handle === handle);
      if (!other || !friendIds(user.id).has(other.id) || typeof muted !== 'boolean') return json(res, 404, { error: 'not found' });
      db.cheerMutes = db.cheerMutes.filter(m => !(m.uid === user.id && m.mutedUid === other.id));
      if (muted) db.cheerMutes.push({ uid: user.id, mutedUid: other.id });
      saveDb();
      json(res, 200, { ok: true });
    }
  };

  return { recordEvents, onSever, routes };
}
