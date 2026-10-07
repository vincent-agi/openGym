/**
 * Keeps each sharing user's earned badges up to date. The rules live in `badges.js`; this file
 * decides when to run them and stores the result in the user's social record.
 */
import { isSharing } from './social.js';
import { ownerTz } from './summary.js';
import { evaluateBadges, mergeEarned } from './badges.js';

/**
 * @param {object} ctx
 * @param {{users: object[]}} ctx.db
 * @param {() => void} ctx.saveDb
 * @param {() => number} [ctx.now]
 * @returns {{
 *   refresh: (user: object, state?: object | null) => string[],
 *   onCheerSent: (user: object) => void,
 *   onCoopCompleted: (uids: string[], date: string) => void
 * }}
 */
export function createBadgeService({ db, saveDb, now = Date.now }) {
  /**
   * Re-evaluates a user's badges. A no-op for users who are not sharing.
   *
   * @param {object} user
   * @param {object | null} [state]  Their saved state; social-only badges can be awarded without it.
   * @returns {string[]} Ids earned just now.
   */
  const refresh = (user, state = null) => {
    if (!isSharing(user)) return [];
    try {
      const social = user.social;
      const found = evaluateBadges(state || {}, now(), ownerTz(state), {
        cheersSent: social.cheersSent || 0, coopCompletedOn: social.coopCompletedOn || null
      });
      const { list, added } = mergeEarned(social.earned || [], found);
      if (added.length) { social.earned = list; saveDb(); }
      return added;
    } catch (e) { console.error('badge refresh failed for', user.id, e); return []; }
  };

  const onCheerSent = user => {
    if (!isSharing(user)) return;
    user.social.cheersSent = (user.social.cheersSent || 0) + 1;
    saveDb();
    refresh(user);
  };

  const onCoopCompleted = (uids, date) => {
    for (const uid of uids) {
      const user = db.users.find(u => u.id === uid);
      if (!isSharing(user)) continue;
      user.social.coopCompletedOn ||= date;
      saveDb();
      refresh(user);
    }
  };

  return { refresh, onCheerSent, onCoopCompleted };
}
