/**
 * Composition root of the friends & challenges module: builds every social service from the
 * server's own helpers and wires them together, so `server.js` only has to mount the result.
 *
 * Services stay independent of one another; the only place that knows how a saved workout becomes
 * a summary, a challenge update, a feed event and a push notification is {@link createSocialModule}.
 */
import { createSocialRoutes } from './social.js';
import { createFriendRoutes, relationsOf } from './friends.js';
import { createSharingService } from './sharing.js';
import { createChallengeService } from './challenge-service.js';
import { createFeedService } from './feed-service.js';
import { createNotifier } from './notifier.js';

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
 *   start: () => void
 * }}
 */
export function createSocialModule({ db, saveDb, readSession, json, readBody, readState, sendPush, now = Date.now }) {
  for (const [key, empty] of Object.entries({
    friendships: [], friendCodes: [], socialSummaries: {}, challenges: [], challengeProgress: {},
    socialEvents: [], socialCheers: [], cheerMutes: [], socialOutbox: [], socialPushLog: []
  })) db[key] ||= empty;

  const notifier = createNotifier({ db, saveDb, sendPush, readState, now });
  const base = { db, saveDb, readSession, json, readBody, readState, notify: notifier.notify, now };
  const sharing = createSharingService(base);
  const challenges = createChallengeService(base);
  const feed = createFeedService(base);

  /** Runs after a user's state was saved: everything derived from it is refreshed. */
  const afterStateSaved = (user, state) => {
    sharing.refresh(user, state);
    challenges.recordProgress(user, state);
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
      if (saved) sharing.refresh(user, saved);
    } else sharing.forget(user.id);
    challenges.onSharingChange(user, wasSharing);
  };

  const routes = {
    ...createSocialRoutes({ ...base, onChange }),
    ...createFriendRoutes({ ...base, onSever: feed.onSever }),
    ...sharing.routes, ...challenges.routes, ...feed.routes
  };

  /** Periodic work: announce finished challenges, then deliver whatever is due. */
  const maintain = async () => {
    for (const ended of challenges.collectEnded()) {
      for (const uid of ended.uids) await notifier.notify(uid, 'challengeEnded', { title: ended.title });
    }
    await notifier.flush();
  };

  const start = () => { setInterval(() => { maintain().catch(e => console.error('social maintenance failed', e)); }, 30000).unref(); };

  return { routes, afterStateSaved, maintain, start };
}
