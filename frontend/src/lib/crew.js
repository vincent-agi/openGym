// Crew leaderboard — pure ranking rules.
//
// A friendly ranking, not a contest: only consistency-style numbers from the shared summary
// are used, ties are never broken by anything but the name, and anyone without a number
// (no session yet, stale data, metric not shared, opted out) is shown neutrally and never
// placed "last".

/** Time spans the leaderboard can show. */
export const PERIODS = ['week', 'month']

/** Numbers friends can be sorted by. */
export const METRICS = ['consistency', 'sessions', 'streak']

/**
 * Metrics available for a period. Consistency compares sessions with the planned week, and
 * no monthly figure is shared, so it is a weekly metric only.
 *
 * @param {'week' | 'month'} period
 * @returns {Array<'consistency' | 'sessions' | 'streak'>}
 */
export const metricsFor = period => (period === 'week' ? METRICS : METRICS.filter(m => m !== 'consistency'))

/**
 * @typedef {object} CrewRow
 * @property {string} handle
 * @property {string} displayName
 * @property {boolean} hideRank  The person opted out of rankings.
 * @property {boolean} stale     Their data is older than two weeks.
 * @property {object | null} summary  Only the fields they share; null before their first sync.
 */
/**
 * @typedef {object} RankedRow
 * @property {string} handle
 * @property {string} displayName
 * @property {boolean} isMe
 * @property {number | null} value      The number sorted on, when there is one.
 * @property {number | null} position   1-based, shared on ties; null when not ranked.
 * @property {'ranked'|'idle'|'noplan'|'stale'|'pending'|'private'|'hidden'} status
 *   Why the row has (or lacks) a position. `idle` means no session yet, never "zero points".
 */

const SUMMARY_KEY = {
  consistency: () => 'weekConsistency',
  sessions: period => (period === 'month' ? 'monthSessions' : 'weekSessions'),
  streak: () => 'streakWeeks'
};

const byName = (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }) || a.handle.localeCompare(b.handle)

/** Classifies one row for a metric: its number (if any) and why it may not be ranked. */
function describe(row, metric, period) {
  if (!row.summary) return { value: null, status: 'pending' }
  if (row.stale) return { value: null, status: 'stale' }
  const key = SUMMARY_KEY[metric](period)
  if (!(key in row.summary)) return { value: null, status: 'private' }
  const value = row.summary[key]
  if (value === null) return { value: null, status: 'noplan' }
  if (row.hideRank) return { value, status: 'hidden' }
  return { value, status: value > 0 ? 'ranked' : 'idle' }
}

/**
 * Builds the leaderboard rows, in display order.
 *
 * @param {CrewRow} me  The signed-in user's own row.
 * @param {CrewRow[]} friends
 * @param {object} options
 * @param {'consistency'|'sessions'|'streak'} options.metric
 * @param {'week'|'month'} options.period
 * @param {boolean} [options.viewerHidesRank]  When true nobody gets a position and the list is alphabetical.
 * @returns {RankedRow[]}
 */
export function rankCrew(me, friends, { metric, period, viewerHidesRank = false }) {
  const rows = [{ ...me, isMe: true }, ...friends.map(f => ({ ...f, isMe: false }))].map(r => ({
    handle: r.handle, displayName: r.displayName, isMe: r.isMe, position: null, ...describe(r, metric, period)
  }));

  if (viewerHidesRank) return rows.sort(byName);

  const ranked = rows.filter(r => r.status === 'ranked').sort((a, b) => b.value - a.value || byName(a, b));
  ranked.forEach(r => { r.position = 1 + ranked.filter(o => o.value > r.value).length; });
  const rest = rows.filter(r => r.status !== 'ranked').sort(byName);
  return [...ranked, ...rest];
}

/**
 * What the compact Home card shows.
 *
 * @param {RankedRow[]} rows  Output of {@link rankCrew}.
 * @returns {{top: RankedRow[], mine: RankedRow | undefined}} The first three ranked people, and the caller's row.
 */
export function crewHighlights(rows) {
  return { top: rows.filter(r => r.position !== null).slice(0, 3), mine: rows.find(r => r.isMe) };
}
