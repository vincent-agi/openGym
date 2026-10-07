/**
 * Composition root of the friends & challenges module: builds every social service from the
 * server's own helpers and wires them together, so `server.ts` only has to mount the result.
 *
 * Services stay independent of one another; the only place that knows how a saved workout becomes
 * a summary, a challenge update, a feed event and a push notification is {@link createSocialModule}.
 */
import { createSocialRoutes } from './social.ts';
import { createFriendRoutes, relationsOf, pruneFriendCodes } from './friends.ts';
import { createSharingService } from './sharing.ts';
import { createChallengeService } from './challenge-service.ts';
import { createFeedService } from './feed-service.ts';
import { createNotifier } from './notifier.ts';
import { createBadgeService } from './badge-service.ts';
import { eraseSocialFootprint } from './social-erase.ts';
import { createLimiter, createGuard } from './rate-limit.ts';
import { bodyFields, emptySocialCollections, SOCIAL_KEYS } from './types.ts';
import type { PushMessage } from './notifier.ts';
import type { Db, Routes, Services, StateDoc, StoredDb, User } from './types.ts';

/** What the composition root hands back to the server. */
export interface SocialModule {
  routes: Routes
  /** Runs after a user's state was saved: everything derived from it is refreshed. */
  afterStateSaved: (user: User, state: StateDoc) => void
  /** Periodic work: announce finished challenges, then deliver whatever is due. */
  maintain: () => Promise<void>
  /** Starts the background timers. */
  start: () => void
  /** Social figures for the admin dashboard: counts only, never who or what. */
  countsFor: (uid: string) => { enabled: boolean; friends: number; challenges: number }
}

/**
 * @param ctx  Server services. `db` is the identity store (the module adds its own collections to it),
 *   `readState` gives a user's saved state, `sendPush` delivers a Web Push, `now` is the clock.
 */
export function createSocialModule({ db: stored, saveDb, readSession, json, readBody, readState, sendPush, now = Date.now }:
  Omit<Services, 'db'> & { db: StoredDb; sendPush: (uid: string, message: PushMessage) => Promise<void> }): SocialModule {
  // A database written before the social module existed lacks its collections.
  const empty = emptySocialCollections();
  for (const key of SOCIAL_KEYS) if (!stored[key]) Object.assign(stored, { [key]: empty[key] });
  const db = stored as Db;   // complete now

  const notifier = createNotifier({ db, saveDb, sendPush, readState, now });
  const badges = createBadgeService({ db, saveDb, now });
  const guard = createGuard({ limiter: createLimiter({ now }), json });
  const base = { db, saveDb, readSession, json, readBody, readState, notify: notifier.notify, onNewCheer: badges.onCheerSent, guard, now };
  const sharing = createSharingService(base);
  const challenges = createChallengeService(base);
  const feed = createFeedService(base);

  /** Runs after a user's state was saved: everything derived from it is refreshed. */
  const afterStateSaved = (user: User, state: StateDoc): void => {
    sharing.refresh(user, state);
    challenges.recordProgress(user, state);
    badges.refresh(user, state);
    const created = feed.recordEvents(user, state);
    if (created.length) {
      for (const friend of relationsOf(db.friendships, user.id).friends) {
        notifier.notify(friend.uid, 'friendSession', { name: user.social!.displayName });   // the user is sharing, so has settings
      }
    }
  };

  /** Reacts to a user turning sharing on or off. */
  const onChange = (user: User, wasSharing: boolean): void => {
    if (user.social?.enabled) {
      const saved = wasSharing ? null : readState(user.id);   // nothing to summarise before the first sync
      if (saved) { sharing.refresh(user, saved); badges.refresh(user, saved); }
    } else sharing.forget(user.id);
    challenges.onSharingChange(user, wasSharing);
  };

  /** A friendship ended (removed or blocked): clean up what the two shared. */
  const onSever = (actor: string, other: string): void => { feed.onSever(actor, other); challenges.onSever(actor, other); };

  const routes: Routes = {
    /**
     * "Leave": erases everything the friends module stored about the caller. Needs `{confirm: true}`
     * so it cannot be triggered by accident, and works whether or not sharing is currently on.
     */
    'POST /api/social/leave': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      if (bodyFields(await readBody(req)).confirm !== true) return json(res, 400, { error: 'send {"confirm": true} to erase your friends data' });
      challenges.eraseUser(user.id, user.social?.handle || '');
      eraseSocialFootprint(db, user.id);
      saveDb();
      json(res, 200, { ok: true });
    },
    ...createSocialRoutes({ ...base, onChange }),
    ...createFriendRoutes({ ...base, onSever }),
    ...sharing.routes, ...challenges.routes, ...feed.routes
  };

  /** Periodic work: announce finished challenges, then deliver whatever is due. */
  const maintain = async (): Promise<void> => {
    challenges.prune();
    const codes = pruneFriendCodes(db.friendCodes, now());
    if (codes.length !== db.friendCodes.length) { db.friendCodes = codes; saveDb(); }
    for (const ended of challenges.collectEnded()) {
      for (const uid of ended.uids) await notifier.notify(uid, 'challengeEnded', { title: ended.title });
      if (ended.coopDone) badges.onCoopCompleted(ended.uids, ended.endDate);
    }
    await notifier.flush();
  };

  const countsFor: SocialModule['countsFor'] = uid => ({
    enabled: !!db.users.find(u => u.id === uid)?.social?.enabled,
    friends: relationsOf(db.friendships, uid).friends.length,
    challenges: db.challenges.filter(c => c.participants.some(p => p.uid === uid && p.status === 'joined')).length
  });

  const start = (): void => { setInterval(() => { maintain().catch(e => console.error('social maintenance failed', e)); }, 30000).unref(); };

  return { routes, afterStateSaved, maintain, start, countsFor };
}
