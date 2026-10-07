/**
 * Stores each sharing user's summary and serves it to their friends.
 *
 * The summary is refreshed on the server whenever the user's state is saved, so the numbers a
 * friend sees always come from {@link computeSummary} and never from client input. Only users
 * who opted in are ever summarised; turning sharing off deletes the stored summary.
 */
import { computeSummary, filterSummary, ownerTz } from './summary.ts';
import { isSharing, requireSharing } from './social.ts';
import type { SharingUser } from './social.ts';
import { relationsOf } from './friends.ts';
import type { CrewRow, CrewSummaryResponse } from '../shared/social.ts';
import type { Routes, Services, StateDoc, User } from './types.ts';

/** What the sharing service hands back to the composition root. */
export interface SharingService {
  /** Recomputes and stores a user's summary; a no-op when they are not sharing. */
  refresh: (user: User, state: StateDoc) => void
  /** Deletes a user's stored summary. */
  forget: (uid: string) => void
  routes: Routes
}

/** A summary not refreshed for this long is flagged `stale` to friends. */
export const STALE_AFTER_MS = 14 * 86400000;

/** Unchanged summaries are still re-persisted this often so `updatedAt` stays meaningful. */
const REFRESH_EVERY_MS = 6 * 3600000;

/**
 * @param ctx  Server services; `now` is the clock, injectable for tests.
 */
export function createSharingService({ db, saveDb, readSession, json, now = Date.now }: Pick<Services, 'db' | 'saveDb' | 'readSession' | 'json'> & { now?: () => number }): SharingService {
  /**
   * Recomputes and stores a user's summary. A no-op for users who are not sharing, and never throws:
   * a bad state must not make saving it fail.
   *
   * @param user   Owner, as found in the identity store.
   * @param state  The state just saved.
   */
  const refresh = (user: User, state: StateDoc): void => {
    if (!isSharing(user)) return;
    try {
      const t = now();
      const data = computeSummary(state, t, ownerTz(state));
      const prev = db.socialSummaries[user.id];
      const unchanged = prev && JSON.stringify(prev.data) === JSON.stringify(data) && t - prev.updatedAt < REFRESH_EVERY_MS;
      if (unchanged) return;
      db.socialSummaries[user.id] = { data, updatedAt: t };
      saveDb();
    } catch (e) {
      console.error('summary refresh failed for', user.id, e);
    }
  };

  /** Deletes a user's stored summary. */
  const forget = (uid: string): void => {
    if (db.socialSummaries[uid]) { delete db.socialSummaries[uid]; saveDb(); }
  };

  const routes: Routes = {
    'GET /api/social/friends/summary': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const t = now();
      const row = (person: SharingUser): CrewRow => {
        const stored = db.socialSummaries[person.id];
        return {
          handle: person.social.handle,
          displayName: person.social.displayName,
          hideRank: !!person.social.hideRank,
          badges: (person.social.earned || []).filter(b => (person.social.showBadges || []).includes(b.id)),
          summary: stored ? filterSummary(stored.data, person.social.share) : null,
          updatedAt: stored?.updatedAt ?? null,
          stale: stored ? t - stored.updatedAt > STALE_AFTER_MS : false
        };
      };
      const friends = relationsOf(db.friendships, user.id).friends
        .map(r => db.users.find(u => u.id === r.uid))
        .filter(isSharing)
        .map(row);
      const answer: CrewSummaryResponse = { me: row(user), friends };
      json(res, 200, answer);
    }
  };

  return { refresh, forget, routes };
}
