/**
 * Composition root of the friends & challenges module: builds every social service from the
 * server's own helpers and wires them together, so `server.js` only has to mount the result.
 *
 * Services stay independent of one another; the only place that knows how a saved workout becomes
 * a summary, a challenge update, a feed event and a push notification is {@link createSocialModule}.
 */
import { createSocialRoutes } from './social.js';
import { createFriendRoutes, relationsOf, pruneFriendCodes } from './friends.js';
import { createSharingService } from './sharing.js';
import { createChallengeService } from './challenge-service.js';
import { createFeedService } from './feed-service.js';
import { createNotifier } from './notifier.js';
import { createBadgeService } from './badge-service.js';
import { eraseSocialFootprint } from './social-erase.js';
import { createLimiter, createGuard } from './rate-limit.js';

/**
 * @param {object} ctx
 * @param {object} ctx.db  Identity store; the module adds its own collections to it.
 * @param {() => void} ctx.saveDb
 * @param {(req: import('node:http').IncomingMessage) => (object | null)} ctx.readSession
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} ctx.json
 * @param {(req: import('node:http').IncomingMessage) => Promise<any>} ctx.readBody
 * @param {(uid: string) => (object | null)} ctx.readState
 * @param {(uid: string, message: object) => Promise<void>} ctx.sendPush
 * @param {() => number} [ctx.now]
 * @returns {{
 *   routes: Record<string, Function>,
 *   afterStateSaved: (user: object, state: object) => void,
 *   maintain: () => Promise<void>,
 *   start: () => void,
 *   countsFor: (uid: string) => {enabled: boolean, friends: number, challenges: number}
 * }}
 */
export function createSocialModule({ db, saveDb, readSession, json, readBody, readState, sendPush, now = Date.now }) {
  for (const [key, empty] of Object.entries({
    friendships: [], friendCodes: [], socialSummaries: {}, challenges: [], challengeProgress: {},
    socialEvents: [], socialCheers: [], cheerMutes: [], socialOutbox: [], socialPushLog: []
  })) db[key] ||= empty;

  const notifier = createNotifier({ db, saveDb, sendPush, readState, now });
  const badges = createBadgeService({ db, saveDb, now });
  const guard = createGuard({ limiter: createLimiter({ now }), json });
  const base = { db, saveDb, readSession, json, readBody, readState, notify: notifier.notify, onNewCheer: badges.onCheerSent, guard, now };
  const sharing = createSharingService(base);
  const challenges = createChallengeService(base);
  const feed = createFeedService(base);

  /** Runs after a user's state was saved: everything derived from it is refreshed. */
  const afterStateSaved = (user, state) => {
    sharing.refresh(user, state);
    challenges.recordProgress(user, state);
    badges.refresh(user, state);
    const created = feed.recordEvents(user, state);
    if (created.length) {
      for (const friend of relationsOf(db.friendships, user.id).friends) {
        notifier.notify(friend.uid, 'friendSession', { name: user.social.displayName });
      }
    }
  };

  /** Reacts to a user turning sharing on or off. */
  const onChange = (user, wasSharing) => {
    if (user.social?.enabled) {
      const saved = wasSharing ? null : readState(user.id);   // nothing to summarise before the first sync
      if (saved) { sharing.refresh(user, saved); badges.refresh(user, saved); }
    } else sharing.forget(user.id);
    challenges.onSharingChange(user, wasSharing);
  };

  /** A friendship ended (removed or blocked): clean up what the two shared. */
  const onSever = (actor, other) => { feed.onSever(actor, other); challenges.onSever(actor, other); };

  const routes = {
    /**
     * "Leave": erases everything the friends module stored about the caller. Needs `{confirm: true}`
     * so it cannot be triggered by accident, and works whether or not sharing is currently on.
     */
    'POST /api/social/leave': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      if ((await readBody(req)).confirm !== true) return json(res, 400, { error: 'send {"confirm": true} to erase your friends data' });
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
  const maintain = async () => {
    challenges.prune();
    const codes = pruneFriendCodes(db.friendCodes, now());
    if (codes.length !== db.friendCodes.length) { db.friendCodes = codes; saveDb(); }
    for (const ended of challenges.collectEnded()) {
      for (const uid of ended.uids) await notifier.notify(uid, 'challengeEnded', { title: ended.title });
      if (ended.coopDone) badges.onCoopCompleted(ended.uids, ended.endDate);
    }
    await notifier.flush();
  };

  /**
   * Social figures for the admin dashboard: counts only, never who or what.
   *
   * @param {string} uid
   * @returns {{enabled: boolean, friends: number, challenges: number}}
   */
  const countsFor = uid => ({
    enabled: !!db.users.find(u => u.id === uid)?.social?.enabled,
    friends: relationsOf(db.friendships, uid).friends.length,
    challenges: db.challenges.filter(c => c.participants.some(p => p.uid === uid && p.status === 'joined')).length
  });

  const start = () => { setInterval(() => { maintain().catch(e => console.error('social maintenance failed', e)); }, 30000).unref(); };

  return { routes, afterStateSaved, maintain, start, countsFor };
}
