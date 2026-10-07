// Cheers & feed — the small pieces the activity feed needs.

import { T } from './i18n.js'

/**
 * The only cheers that exist. Must match `CHEER_EMOJI` in `api/feed.js`; a test compares them.
 * @type {readonly string[]}
 */
export const CHEER_EMOJI = Object.freeze(['👏', '🔥', '💪', '🎉', '❤️'])

/**
 * One line of emoji for the cheers received, e.g. `👏🔥🔥`.
 *
 * @param {Array<{emoji: string, count: number}> | undefined} cheers
 * @returns {string}
 */
export function cheerLine(cheers) {
  return (cheers || []).map(c => c.emoji.repeat(c.count)).join('')
}

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * Relative time of an event, as a template for `t()` and the number to fill in.
 *
 * @param {number} then  Epoch ms of the event.
 * @param {number} now   Epoch ms.
 * @returns {{template: string, n: number}}
 */
export function timeAgo(then, now) {
  const diff = Math.max(0, now - then)
  if (diff < MIN) return { template: T('Just now'), n: 0 }
  if (diff < HOUR) return { template: T('{0} min ago'), n: Math.floor(diff / MIN) }
  if (diff < DAY) return { template: T('{0} h ago'), n: Math.floor(diff / HOUR) }
  if (diff < 2 * DAY) return { template: T('Yesterday'), n: 1 }
  return { template: T('{0} days ago'), n: Math.floor(diff / DAY) }
}
