// Planned breaks — time off (illness, travel, injury) that must not count against anyone's consistency.
//
// A break is just a date range kept in the user's own synced state (`S.breaks`). The reason is
// never recorded, and the server cuts every break to 14 days (api/summary.js), so the app does
// the same here to keep both sides in agreement.

import { addDaysIso } from './challenges.js'

/** Longest planned break, in days. Mirrors the API. */
export const MAX_BREAK_DAYS = 14

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const KEEP_DAYS = 90

/**
 * @typedef {{from: string, to: string}} Break
 */

/**
 * Adds a break, cut to 14 days, keeping the list ordered and dropping breaks over 90 days old.
 *
 * @param {Break[] | undefined} list  Current breaks; not modified.
 * @param {string} from   First day, ISO.
 * @param {string} to     Last day, ISO, inclusive.
 * @param {string} [today]  Used to prune old breaks; ISO.
 * @returns {Break[]} A new list, or the same list when the dates are invalid.
 */
export function planBreak(list, from, to, today = from) {
  const current = list || []
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) return current
  const last = addDaysIso(from, MAX_BREAK_DAYS - 1)
  const cutoff = addDaysIso(today, -KEEP_DAYS)
  return [...current.filter(b => b.to >= cutoff), { from, to: to < last ? to : last }].sort((a, b) => (a.from < b.from ? -1 : 1))
}

/**
 * The break running on a day, or else the next one to come.
 *
 * @param {Break[] | undefined} list
 * @param {string} today  ISO.
 * @returns {Break | null}
 */
export function activeBreak(list, today) {
  return (list || []).find(b => b.to >= today) || null
}

/**
 * Cancels the running and upcoming breaks; earlier ones stay as history.
 *
 * @param {Break[] | undefined} list
 * @param {string} today  ISO.
 * @returns {Break[]}
 */
export function clearBreaks(list, today) {
  return (list || []).filter(b => b.to < today)
}
