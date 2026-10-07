// Badges — names and descriptions for the rewards the server awards (see api/badges.js).
//
// The server decides who earned what; this file only says what each badge is called and why it
// exists. There is deliberately nothing here about strength, size or coming first.

/**
 * @typedef {object} BadgeInfo
 * @property {string} id
 * @property {string} name         English key for `t()`.
 * @property {string} description  English key for `t()`.
 */

/**
 * Every badge, in the order the API lists them. A test keeps the ids equal to the API's.
 * @type {BadgeInfo[]}
 */
export const CATALOG = [
  { id: 'first-week', name: 'First week', description: 'You finished your first session. Everything starts here.' },
  { id: 'hat-trick', name: 'Hat-trick', description: 'Three sessions in a single week.' },
  { id: 'four-in-a-row', name: 'Four in a row', description: 'A session every week for four weeks running.' },
  { id: 'back-on-track', name: 'Back on track', description: 'You came back after a break or a missed week. That takes courage.' },
  { id: 'team-player', name: 'Team player', description: 'You finished a co-op challenge together with your friends.' },
  { id: 'cheerleader', name: 'Cheerleader', description: 'You sent ten cheers to your friends.' }
]

/**
 * Looks a badge up; an id this version does not know yet still renders.
 *
 * @param {string} id
 * @returns {BadgeInfo}
 */
export const badgeInfo = id => CATALOG.find(b => b.id === id) || { id, name: id, description: '' }

/**
 * The earned badges the user has not been told about yet.
 *
 * @param {Array<{id: string, date: string}> | undefined} earned
 * @param {string[] | null | undefined} seen  Ids already celebrated; null before the first visit.
 * @returns {Array<{id: string, date: string}>}
 */
export function newBadges(earned, seen) {
  const known = new Set(seen || [])
  return (earned || []).filter(b => !known.has(b.id))
}
