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
import { addDays, mondayOf, isoInZone, isSession, breaksOf } from './summary.js';

/** Every badge that exists. Mirrored by name and description in `frontend/src/lib/badges.js`. */
export const BADGES = Object.freeze(['first-week', 'hat-trick', 'four-in-a-row', 'back-on-track', 'team-player', 'cheerleader']);

/** Cheers a user must have sent for the Cheerleader badge. */
export const CHEERLEADER_AT = 10;

/**
 * @typedef {object} Earned
 * @property {string} id    One of {@link BADGES}.
 * @property {string} date  ISO date it was first earned.
 */

/**
 * Works out which badges a user qualifies for, and the day each was first deserved.
 *
 * @param {object} state  The user's synced state; read for workouts and planned breaks only.
 * @param {number} now    Epoch ms.
 * @param {string} tz     The owner's IANA time zone.
 * @param {{cheersSent?: number, coopCompletedOn?: string | null}} [facts]  Social facts the state cannot tell.
 * @returns {Earned[]}
 */
export function evaluateBadges(state, now, tz, facts = {}) {
  if (!state || typeof state !== 'object') return [];
  const today = isoInZone(now, tz);
  const sessions = (Array.isArray(state.workouts) ? state.workouts : [])
    .filter(w => isSession(w, today)).map(w => w.d).sort();
  const out = [];
  const award = (id, date) => out.push({ id, date });

  if (sessions.length) {
    award('first-week', sessions[0]);

    const byWeek = new Map();
    for (const d of sessions) { const wk = mondayOf(d); byWeek.set(wk, [...(byWeek.get(wk) || []), d]); }
    const weeks = [...byWeek.keys()].sort();

    const full = weeks.find(wk => byWeek.get(wk).length >= 3);
    if (full) award('hat-trick', byWeek.get(full)[2]);

    let run = 0, prev = null, fourth = null;
    for (const wk of weeks) {
      run = prev && addDays(prev, 7) === wk ? run + 1 : 1;
      prev = wk;
      if (run === 4 && !fourth) fourth = byWeek.get(wk)[0];
    }
    if (fourth) award('four-in-a-row', fourth);

    const returns = [];
    for (let i = 1; i < weeks.length; i++) if (addDays(weeks[i - 1], 7) !== weeks[i]) returns.push(byWeek.get(weeks[i])[0]);
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
 * @param {Earned[]} have  Already earned; not modified.
 * @param {Earned[]} found  From {@link evaluateBadges}.
 * @returns {{list: Earned[], added: string[]}}  The merged list and the ids that are new.
 */
export function mergeEarned(have, found) {
  const known = new Set(have.map(b => b.id));
  const fresh = found.filter(b => !known.has(b.id));
  return { list: [...have, ...fresh], added: fresh.map(b => b.id) };
}

/**
 * Validates the list of badges a user lets friends see.
 *
 * @param {unknown} input
 * @returns {{ok: true, value: string[]} | {ok: false, error: string}}
 */
export function validateShowBadges(input) {
  if (!Array.isArray(input) || input.some(id => !BADGES.includes(id))) return { ok: false, error: 'showBadges must be a list of badge ids' };
  return { ok: true, value: [...new Set(input)] };
}
