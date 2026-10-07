/**
 * Shared activity summary: the only thing a friend can ever learn about someone's training.
 *
 * {@link computeSummary} is a pure function of a user's synced app state. It reads training
 * history and the weekly plan and nothing else (never body weight, measurements, nutrition,
 * effort ratings, the mobility profile, exercise names, weights, reps or timestamps finer than
 * a day), and returns a fixed set of keys, {@link SUMMARY_KEYS}. A test fails the moment a key
 * is added without being reviewed.
 *
 * The server computes it from the state it already receives, so a client can never submit a
 * summary of its own.
 */

/** Every key a summary may contain. Adding one is a privacy decision: update the tests with it. */
export const SUMMARY_KEYS = Object.freeze([
  'weekSessions', 'weekPlanned', 'weekConsistency', 'monthSessions', 'streakWeeks', 'activeDays', 'lastActiveDate', 'prCount'
]);

/** Days of history behind `activeDays` and `prCount`. */
export const WINDOW_DAYS = 28;

const DAY_MS = 86400000;
const MAX_STREAK_WEEKS = 520;

/** @param {string} iso `YYYY-MM-DD` @returns {Date} noon UTC, immune to DST arithmetic */
const utcNoon = iso => new Date(iso + 'T12:00:00Z');
/** @param {Date} d @returns {string} */
const toIso = d => d.toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Adds days to an ISO date.
 *
 * @param {string} iso  `YYYY-MM-DD`.
 * @param {number} n    Days to add; may be negative.
 * @returns {string}
 */
export function addDays(iso, n) {
  return toIso(new Date(utcNoon(iso).getTime() + n * DAY_MS));
}

/**
 * Monday of the week containing a date (weeks run Monday to Sunday).
 *
 * @param {string} iso
 * @returns {string}
 */
export function mondayOf(iso) {
  const dow = (utcNoon(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/**
 * The calendar date, as `YYYY-MM-DD`, at an instant in a time zone. An unknown zone falls
 * back to UTC rather than failing a save.
 *
 * @param {number} ms  Epoch milliseconds.
 * @param {string} tz  IANA zone, e.g. `Europe/Paris`.
 * @returns {string}
 */
export function isoInZone(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return toIso(new Date(ms));
  }
}

/** Routine planned for a day: a valid override wins over the weekly plan. Mirrors the app. */
function plannedRoutine(state, iso) {
  const override = state.dayPlan?.[iso];
  if (override === 'rest') return null;
  if (override && state.routines?.some(r => r.id === override)) return override;
  return state.week?.[utcNoon(iso).getUTCDay()] || null;
}

/** A workout counts as a session when it has a valid date not after `today` and one completed set. */
function isSession(w, today) {
  return !!w && typeof w.d === 'string' && ISO_DAY.test(w.d) && w.d <= today
    && Array.isArray(w.entries) && w.entries.some(e => Array.isArray(e?.sets) && e.sets.some(s => s?.done));
}

/**
 * @typedef {object} Summary
 * @property {number} weekSessions        Sessions this week (Monday to today).
 * @property {number} weekPlanned         Sessions the user planned for the whole week.
 * @property {number | null} weekConsistency  `weekSessions / weekPlanned`, capped at 1, two decimals; null when nothing was planned.
 * @property {number} monthSessions       Sessions this calendar month.
 * @property {number} streakWeeks         Consecutive weeks with a session; a week with none yet does not break it.
 * @property {string[]} activeDays        ISO dates with a session in the last 28 days, ascending. No other detail.
 * @property {string | null} lastActiveDate  Most recent session date.
 * @property {number} prCount             Personal records in the last 28 days.
 */

/**
 * Derives the shareable summary from a user's app state.
 *
 * @param {object} state  The user's synced state; never modified, and tolerated when malformed.
 * @param {number} now    Instant to compute "today" from, in epoch milliseconds.
 * @param {string} tz     The owner's IANA time zone, so weeks do not shift for people abroad.
 * @returns {Summary}
 */
export function computeSummary(state, now, tz) {
  const st = state && typeof state === 'object' ? state : {};
  const today = isoInZone(now, tz);
  const sessions = (Array.isArray(st.workouts) ? st.workouts : []).filter(w => isSession(w, today));

  const weekStart = mondayOf(today);
  const weekSessions = sessions.filter(w => w.d >= weekStart).length;
  const monthSessions = sessions.filter(w => w.d.slice(0, 7) === today.slice(0, 7)).length;

  let weekPlanned = 0;
  for (let i = 0; i < 7; i++) if (plannedRoutine(st, addDays(weekStart, i))) weekPlanned++;
  const weekConsistency = weekPlanned ? Math.round(Math.min(1, weekSessions / weekPlanned) * 100) / 100 : null;

  const trainedWeeks = new Set(sessions.map(w => mondayOf(w.d)));
  let streakWeeks = 0;
  for (let i = 0, cursor = weekStart; i < MAX_STREAK_WEEKS; i++, cursor = addDays(cursor, -7)) {
    if (trainedWeeks.has(cursor)) streakWeeks++;
    else if (i > 0) break;
  }

  const windowStart = addDays(today, -(WINDOW_DAYS - 1));
  const recent = sessions.filter(w => w.d >= windowStart);
  const activeDays = [...new Set(recent.map(w => w.d))].sort();
  const prCount = recent.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0);

  return {
    weekSessions, weekPlanned, weekConsistency, monthSessions, streakWeeks, activeDays,
    lastActiveDate: sessions.length ? sessions.reduce((m, w) => (w.d > m ? w.d : m), '') : null,
    prCount
  };
}

// Which summary keys each sharing choice unlocks.
const SHARE_KEYS = {
  sessions: ['weekSessions', 'monthSessions', 'activeDays', 'lastActiveDate'],
  consistency: ['weekPlanned', 'weekConsistency'],
  streak: ['streakWeeks'],
  prs: ['prCount']
};

/**
 * Keeps only what the user chose to share.
 *
 * @param {Summary} summary
 * @param {{sessions?: boolean, streak?: boolean, consistency?: boolean, prs?: boolean}} share
 * @returns {Partial<Summary>}
 */
export function filterSummary(summary, share) {
  const out = {};
  for (const [choice, keys] of Object.entries(SHARE_KEYS)) {
    if (share?.[choice]) for (const k of keys) out[k] = summary[k];
  }
  return out;
}
