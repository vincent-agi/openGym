/**
 * Keeps each sharing user's earned badges up to date. The rules live in `badges.ts`; this file
 * decides when to run them and stores the result in the user's social record.
 */
import { isSharing } from './social.ts';
import { ownerTz } from './summary.ts';
import { evaluateBadges, mergeEarned } from './badges.ts';
import type { BadgeId } from '../shared/constants.ts';
import type { Services, StateDoc, User } from './types.ts';

/** What the badge service hands back to the composition root. */
export interface BadgeService {
  /** Re-evaluates a user's badges and returns the ids earned just now. */
  refresh: (user: User, state?: StateDoc | null) => BadgeId[]
  /** A user sent a cheer: counts toward the Cheerleader badge. */
  onCheerSent: (user: User) => void
  /** A co-op challenge was completed together by these users. */
  onCoopCompleted: (uids: string[], date: string) => void
}

export function createBadgeService({ db, saveDb, now = Date.now }: Pick<Services, 'db' | 'saveDb'> & { now?: () => number }): BadgeService {
  /**
   * Re-evaluates a user's badges. A no-op for users who are not sharing.
   *
   * @param user
   * @param state  Their saved state; social-only badges can be awarded without it.
   * @returns Ids earned just now.
   */
  const refresh = (user: User, state: StateDoc | null = null): BadgeId[] => {
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

  const onCheerSent = (user: User): void => {
    if (!isSharing(user)) return;
    user.social.cheersSent = (user.social.cheersSent || 0) + 1;
    saveDb();
    refresh(user);
  };

  const onCoopCompleted = (uids: string[], date: string): void => {
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
