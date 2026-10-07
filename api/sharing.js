/**
 * Stores each sharing user's summary and serves it to their friends.
 *
 * The summary is refreshed on the server whenever the user's state is saved, so the numbers a
 * friend sees always come from {@link computeSummary} and never from client input. Only users
 * who opted in are ever summarised; turning sharing off deletes the stored summary.
 */
import { computeSummary, filterSummary } from './summary.js';
import { isSharing, requireSharing } from './social.js';
import { relationsOf } from './friends.js';

/** A summary not refreshed for this long is flagged `stale` to friends. */
export const STALE_AFTER_MS = 14 * 86400000;

/** Unchanged summaries are still re-persisted this often so `updatedAt` stays meaningful. */
const REFRESH_EVERY_MS = 6 * 3600000;

/**
 * @typedef {object} StoredSummary
 * @property {import('./summary.js').Summary} data
 * @property {number} updatedAt  Epoch ms of the last refresh.
 */

/**
 * @param {object} ctx
 * @param {{users: object[], friendships: object[], socialSummaries: Record<string, StoredSummary>}} ctx.db
 * @param {() => void} ctx.saveDb
 * @param {(req: import('node:http').IncomingMessage) => (object | null)} ctx.readSession
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} ctx.json
 * @param {() => number} [ctx.now]  Clock, injectable for tests.
 * @returns {{
 *   refresh: (user: object, state: object) => void,
 *   forget: (uid: string) => void,
 *   routes: Record<string, Function>
 * }}
 */
export function createSharingService({ db, saveDb, readSession, json, now = Date.now }) {
  /**
   * Recomputes and stores a user's summary. A no-op for users who are not sharing, and never throws:
   * a bad state must not make saving it fail.
   *
   * @param {object} user   Owner, as found in the identity store.
   * @param {object} state  The state just saved.
   */
  const refresh = (user, state) => {
    if (!isSharing(user)) return;
    try {
      const t = now();
      const data = computeSummary(state, t, state?.reminder?.tz || 'UTC');
      const prev = db.socialSummaries[user.id];
      const unchanged = prev && JSON.stringify(prev.data) === JSON.stringify(data) && t - prev.updatedAt < REFRESH_EVERY_MS;
      if (unchanged) return;
      db.socialSummaries[user.id] = { data, updatedAt: t };
      saveDb();
    } catch (e) {
      console.error('summary refresh failed for', user.id, e);
    }
  };

  /** Deletes a user's stored summary. @param {string} uid */
  const forget = uid => {
    if (db.socialSummaries[uid]) { delete db.socialSummaries[uid]; saveDb(); }
  };

  const routes = {
    'GET /api/social/friends/summary': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const t = now();
      const friends = relationsOf(db.friendships, user.id).friends
        .map(r => db.users.find(u => u.id === r.uid))
        .filter(isSharing)
        .map(friend => {
          const stored = db.socialSummaries[friend.id];
          return {
            handle: friend.social.handle,
            displayName: friend.social.displayName,
            summary: stored ? filterSummary(stored.data, friend.social.share) : null,
            updatedAt: stored?.updatedAt ?? null,
            stale: stored ? t - stored.updatedAt > STALE_AFTER_MS : false
          };
        });
      json(res, 200, { friends });
    }
  };

  return { refresh, forget, routes };
}
