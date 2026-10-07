// Weekly recap — the warm Monday summary on Home.
//
// Built from the user's own data plus what friends chose to share. The closing line is picked by
// fixed rules, never at random, and none of them can sound like a reproach.

import { effectiveRoutineId } from './history.js'
import { addDaysIso } from './challenges.js'

/** Key under which the dismissal is remembered. */
export const RECAP_DISMISS_KEY = 'gymme_recap_dismissed'

/**
 * Monday of the week containing a date.
 *
 * @param {string} iso
 * @returns {string}
 */
export function weekStartOf(iso) {
  const dow = (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7
  return addDaysIso(iso, -dow)
}

/**
 * Whether the recap should be on screen: Monday to Wednesday, until dismissed for the week or for good.
 *
 * @param {string} today  ISO date.
 * @param {string | null} dismissed  `'never'`, the Monday of the week it was dismissed, or null.
 * @returns {boolean}
 */
export function recapVisible(today, dismissed) {
  if (dismissed === 'never') return false
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7
  return dow <= 2 && dismissed !== weekStartOf(today)
}

const inBreak = (S, iso) => (S.breaks || []).some(b => iso >= b.from && iso <= b.to)
const counts = w => (w.entries || []).some(e => (e.sets || []).some(s => s.done))

/**
 * Last week's sessions against last week's plan. Days inside a planned break are not planned.
 *
 * @param {object} S      The user's app state.
 * @param {string} today  ISO date.
 * @returns {{sessions: number, planned: number, from: string, to: string}}
 */
export function lastWeekStats(S, today) {
  const from = addDaysIso(weekStartOf(today), -7)
  const to = addDaysIso(from, 6)
  const sessions = (S.workouts || []).filter(w => w.d >= from && w.d <= to && counts(w)).length
  let planned = 0
  for (let i = 0; i < 7; i++) {
    const day = addDaysIso(from, i)
    if (effectiveRoutineId(S, day) && !inBreak(S, day)) planned++
  }
  return { sessions, planned, from, to }
}

/** Consecutive weeks with a session, ending this week or last. */
function streakOf(S, today) {
  const trained = new Set((S.workouts || []).filter(counts).map(w => weekStartOf(w.d)))
  let streak = 0
  for (let wk = weekStartOf(today), i = 0; i < 520; wk = addDaysIso(wk, -7), i++) {
    if (trained.has(wk)) streak++
    else if (i > 0) break
  }
  return streak
}

/**
 * The closing sentence, chosen by fixed rules. Encouraging in every case.
 *
 * @param {{sessions: number, planned: number}} stats
 * @returns {string} English key for `t()`.
 */
export function recapLine({ sessions, planned }) {
  if (planned > 0 && sessions >= planned) return 'You did everything you planned. Brilliant.'
  if (planned > 0 && sessions === 0) return 'A new week is a fresh start. One session is all it takes.'
  if (planned === 0 && sessions > 0) return 'You trained without a fixed plan. Great!'
  if (sessions > 0) return 'Every session counts. Nice week.'
  return 'Ready for a new week?'
}

/**
 * Everything the recap card shows.
 *
 * @param {object} S
 * @param {{crewSessions: number | null, challenge: {title: string, pct: number} | null} | null} social
 *   What sharing adds, or null when the user does not share.
 * @param {string} today  ISO date.
 * @returns {{weekStart: string, sessions: number, planned: number, streak: number, challenge: object | null, crewSessions: number | null, line: string}}
 */
export function buildRecap(S, social, today) {
  const stats = lastWeekStats(S, today)
  return {
    weekStart: weekStartOf(today),
    sessions: stats.sessions,
    planned: stats.planned,
    streak: streakOf(S, today),
    challenge: social?.challenge ?? null,
    crewSessions: social?.crewSessions ?? null,
    line: recapLine(stats)
  }
}
