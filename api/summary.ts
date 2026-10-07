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

import { SUMMARY_KEYS, MAX_BREAK_DAYS } from '../shared/constants.ts';
import type { ShareKey } from '../shared/constants.ts';
import type { Summary, SharedSummary, SharePrefs } from '../shared/social.ts';
import type { StateDoc } from './types.ts';

export type { Summary, SharedSummary };

/** A planned break, both days included. */
export interface Break { from: string; to: string }

/**
 * A workout that counts as a session (see {@link isSession}). The state is untrusted, so only what the
 * check proved is typed; the contents of `entries` and `prs` are narrowed where they are read.
 */
export interface Session { id?: unknown; d: string; entries: unknown[]; prs?: unknown }

/** A plain object of an untrusted document, or null for anything else. */
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

// Every key a summary may contain, and the longest planned break, live in shared/constants.ts (the
// frontend renders from the same lists). Adding a key is a privacy decision: update the tests with it.
export { SUMMARY_KEYS, MAX_BREAK_DAYS };

/** Days of history behind `activeDays` and `prCount`. */
export const WINDOW_DAYS = 28;

const DAY_MS = 86400000;
const MAX_STREAK_WEEKS = 520;

/** Noon UTC of an ISO `YYYY-MM-DD` date, immune to DST arithmetic. */
const utcNoon = (iso: string): Date => new Date(iso + 'T12:00:00Z');
const toIso = (d: Date): string => d.toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Adds days to an ISO date.
 *
 * @param iso  `YYYY-MM-DD`.
 * @param n    Days to add; may be negative.
 */
export function addDays(iso: string, n: number): string {
  return toIso(new Date(utcNoon(iso).getTime() + n * DAY_MS));
}

/**
 * Monday of the week containing a date (weeks run Monday to Sunday).
 *
 * @param iso  `YYYY-MM-DD`.
 */
export function mondayOf(iso: string): string {
  const dow = (utcNoon(iso).getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

/**
 * The time zone a user's app stamped on their state (so a week boundary does not move for people
 * abroad), or null when it never did, for instance before they first opened the friends screens.
 *
 * @param state
 */
export function ownerTz(state: StateDoc | null | undefined): string | null {
  const tz = asRecord(state?.reminder)?.tz || state?.tz;
  return typeof tz === 'string' && tz ? tz : null;
}

/**
 * The latest date a session may carry and still be believed. With the zone known, that is today
 * there. With none, UTC is a guess: anyone east of Greenwich is already on the next date, so one
 * day of slack is allowed (more would let a hand-edited state run ahead).
 *
 * @param today  Today's ISO date in the zone used.
 * @param tz     The owner's zone, if known.
 */
export function sessionLimit(today: string, tz: string | null | undefined): string {
  return tz ? today : addDays(today, 1);
}

/**
 * The calendar date, as `YYYY-MM-DD`, at an instant in a time zone. An unknown zone falls
 * back to UTC rather than failing a save.
 *
 * @param ms  Epoch milliseconds.
 * @param tz  IANA zone, e.g. `Europe/Paris`.
 */
export function isoInZone(ms: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  } catch {
    return toIso(new Date(ms));
  }
}

/**
 * Routine planned for a day: a valid override wins over the weekly plan. Mirrors the app.
 *
 * @param state
 * @param iso  `YYYY-MM-DD`.
 */
export function plannedRoutine(state: StateDoc, iso: string): string | null {
  const override = asRecord(state.dayPlan)?.[iso];
  if (override === 'rest') return null;
  if (typeof override === 'string' && override && Array.isArray(state.routines) && state.routines.some(r => asRecord(r)?.id === override)) return override;
  const planned = asRecord(state.week)?.[utcNoon(iso).getUTCDay()];
  return typeof planned === 'string' && planned ? planned : null;
}

/**
 * The planned breaks a user declared (illness, travel, injury), made safe: malformed entries are
 * dropped and each break is cut to {@link MAX_BREAK_DAYS}. Only the dates are ever read, never a reason.
 *
 * @param state
 */
export function breaksOf(state: StateDoc | null | undefined): Break[] {
  if (!Array.isArray(state?.breaks)) return [];
  return (state.breaks as unknown[])
    .filter((b): b is Break => !!asRecord(b) && typeof asRecord(b)!.from === 'string' && typeof asRecord(b)!.to === 'string'
      && ISO_DAY.test((b as Break).from) && ISO_DAY.test((b as Break).to) && (b as Break).from <= (b as Break).to)
    .map(b => ({ from: b.from, to: b.to < addDays(b.from, MAX_BREAK_DAYS - 1) ? b.to : addDays(b.from, MAX_BREAK_DAYS - 1) }));
}

/**
 * Whether a session was planned on a day: a routine is scheduled and the day is not inside a planned break.
 *
 * @param state
 * @param iso  `YYYY-MM-DD`.
 */
export function isPlanned(state: StateDoc, iso: string): boolean {
  return !!plannedRoutine(state, iso) && !breaksOf(state).some(b => iso >= b.from && iso <= b.to);
}

/**
 * A workout counts as a session when it has a valid date not after `today` and one completed set.
 *
 * @param w
 * @param today  ISO date.
 */
export function isSession(w: unknown, today: string): w is Session {
  const workout = asRecord(w);
  return !!workout && typeof workout.d === 'string' && ISO_DAY.test(workout.d) && workout.d <= today
    && Array.isArray(workout.entries)
    && workout.entries.some(e => { const sets = asRecord(e)?.sets; return Array.isArray(sets) && sets.some(set => asRecord(set)?.done); });
}

/**
 * Derives the shareable summary from a user's app state.
 *
 * @param state  The user's synced state; never modified, and tolerated when malformed.
 * @param now    Instant to compute "today" from, in epoch milliseconds.
 * @param tz     The owner's IANA time zone if known ({@link ownerTz}); UTC is assumed otherwise.
 */
export function computeSummary(state: unknown, now: number, tz: string | null | undefined): Summary {
  const st: StateDoc = state && typeof state === 'object' ? (state as StateDoc) : {};
  const today = isoInZone(now, tz || 'UTC');
  const limit = sessionLimit(today, tz);
  const sessions = (Array.isArray(st.workouts) ? (st.workouts as unknown[]) : []).filter((w): w is Session => isSession(w, limit));

  const weekStart = mondayOf(today);
  const weekSessions = sessions.filter(w => w.d >= weekStart).length;
  const monthSessions = sessions.filter(w => w.d.slice(0, 7) === today.slice(0, 7)).length;

  let weekPlanned = 0;
  for (let i = 0; i < 7; i++) if (isPlanned(st, addDays(weekStart, i))) weekPlanned++;
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

  const perWeek = (weeksAgo: number) => { const mon = addDays(weekStart, -7 * weeksAgo); return sessions.filter(w => w.d >= mon && w.d <= addDays(mon, 6)).length; };
  const sum = (from: number, to: number) => { let n = 0; for (let k = from; k <= to; k++) n += perWeek(k); return n; };
  const lastFour = sum(1, 4), priorFour = sum(5, 8);
  const weeklyTrend = lastFour + priorFour ? Math.round(((lastFour - priorFour) / 4) * 10) / 10 : null;

  return {
    weekSessions, weekPlanned, weekConsistency, monthSessions, streakWeeks, activeDays,
    lastActiveDate: sessions.length ? sessions.reduce((m, w) => (w.d > m ? w.d : m), '') : null,
    prCount, weeklyTrend
  };
}

// Which summary keys each sharing choice unlocks.
const SHARE_KEYS: Record<ShareKey, Array<keyof Summary>> = {
  sessions: ['weekSessions', 'monthSessions', 'activeDays', 'lastActiveDate'],
  consistency: ['weekPlanned', 'weekConsistency', 'weeklyTrend'],
  streak: ['streakWeeks'],
  prs: ['prCount']
};

/**
 * Keeps only what the user chose to share.
 *
 * @param summary
 * @param share  Which choices are on; anything missing counts as off.
 */
export function filterSummary(summary: Summary, share: Partial<SharePrefs> | null | undefined): SharedSummary {
  const out: Record<string, unknown> = {};
  for (const [choice, keys] of Object.entries(SHARE_KEYS) as Array<[ShareKey, Array<keyof Summary>]>) {
    if (share?.[choice]) for (const k of keys) out[k] = summary[k];
  }
  return out as SharedSummary;
}
