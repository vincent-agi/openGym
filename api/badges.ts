/**
 * Badges: small rewards for habits, never for strength, size or beating anyone.
 *
 * Every rule here is about showing up (a first week, three sessions in a week, a month of weeks,
 * coming back after a pause) or about being a good teammate (finishing a co-op challenge,
 * cheering friends on). There is deliberately no badge for the heaviest lift, the biggest
 * change or first place.
 *
 * Badges are computed on the server from the user's own saved state and from social facts
 * (cheers sent, co-op challenges completed), then stored: once earned, never taken back.
 */
import { BADGES } from '../shared/constants.ts';
import type { BadgeId } from '../shared/constants.ts';
import type { Earned } from '../shared/social.ts';
import type { StateDoc } from './types.ts';

export type { Earned };
import { addDays, mondayOf, isoInZone, isSession, breaksOf, sessionLimit } from './summary.ts';

// Every badge that exists lives in shared/constants.ts; names and descriptions are in the frontend.
export { BADGES };

/** Cheers a user must have sent for the Cheerleader badge. */
export const CHEERLEADER_AT = 10;

/** Social facts the state cannot tell, gathered by the badge service. */
export interface BadgeFacts { cheersSent?: number; coopCompletedOn?: string | null }

/** Outcome of {@link validateShowBadges}. */
export type ShowBadgesValidation = { ok: true; value: BadgeId[] } | { ok: false; error: string };

const isBadgeId = (id: unknown): id is BadgeId => (BADGES as readonly unknown[]).includes(id);

/**
 * Works out which badges a user qualifies for, and the day each was first deserved.
 *
 * @param state  The user's synced state; read for workouts and planned breaks only.
 * @param now    Epoch ms.
 * @param tz     The owner's IANA time zone.
 * @param facts  Social facts the state cannot tell.
 */
export function evaluateBadges(state: StateDoc | null | undefined, now: number, tz: string | null | undefined, facts: BadgeFacts = {}): Earned[] {
  if (!state || typeof state !== 'object') return [];
  const today = isoInZone(now, tz || 'UTC');
  const limit = sessionLimit(today, tz);
  const sessions = (Array.isArray(state.workouts) ? state.workouts : [])
    .filter(w => isSession(w, limit)).map(w => w.d).sort();
  const out: Earned[] = [];
  const award = (id: BadgeId, date: string) => out.push({ id, date });

  if (sessions.length) {
    award('first-week', sessions[0]);

    const byWeek = new Map<string, string[]>();
    for (const d of sessions) { const wk = mondayOf(d); byWeek.set(wk, [...(byWeek.get(wk) || []), d]); }
    const weeks = [...byWeek.keys()].sort();
    /** The sessions of a week that has at least one (the weeks are the keys of the map). */
    const daysOf = (wk: string): string[] => byWeek.get(wk)!;

    const full = weeks.find(wk => daysOf(wk).length >= 3);
    if (full) award('hat-trick', daysOf(full)[2]);

    let run = 0, prev: string | null = null, fourth: string | null = null;
    for (const wk of weeks) {
      run = prev && addDays(prev, 7) === wk ? run + 1 : 1;
      prev = wk;
      if (run === 4 && !fourth) fourth = daysOf(wk)[0];
    }
    if (fourth) award('four-in-a-row', fourth);

    const returns: string[] = [];
    for (let i = 1; i < weeks.length; i++) if (addDays(weeks[i - 1], 7) !== weeks[i]) returns.push(daysOf(weeks[i])[0]);
    for (const b of breaksOf(state)) {
      const back = sessions.find(d => d > b.to && d <= addDays(b.to, 7));
      if (back) returns.push(back);
    }
    if (returns.length) award('back-on-track', returns.sort()[0]);
  }

  if (facts.coopCompletedOn) award('team-player', facts.coopCompletedOn);
  if ((facts.cheersSent || 0) >= CHEERLEADER_AT) award('cheerleader', today);
  return out;
}

/**
 * Adds newly earned badges to the stored list. Nothing is ever removed or re-dated.
 *
 * @param have   Already earned; not modified.
 * @param found  From {@link evaluateBadges}.
 * @returns The merged list and the ids that are new.
 */
export function mergeEarned(have: Earned[], found: Earned[]): { list: Earned[]; added: BadgeId[] } {
  const known = new Set(have.map(b => b.id));
  const fresh = found.filter(b => !known.has(b.id));
  return { list: [...have, ...fresh], added: fresh.map(b => b.id) };
}

/**
 * Validates the list of badges a user lets friends see.
 *
 * @param input
 */
export function validateShowBadges(input: unknown): ShowBadgesValidation {
  if (!Array.isArray(input) || input.some(id => !isBadgeId(id))) return { ok: false, error: 'showBadges must be a list of badge ids' };
  return { ok: true, value: [...new Set(input)] };
}
