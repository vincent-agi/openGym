/**
 * Notification preferences of the social module: which events may reach a user, and the hours
 * when nothing should. Pure data and validation, no dependencies.
 *
 * Everything starts **off**; a user is only ever pinged about something they asked for.
 */

/** Events a user can opt in to. */
export const NOTIFY_KINDS = Object.freeze(['friendSession', 'cheerReceived', 'challengeInvite', 'challengeMilestone', 'challengeEnded']);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * @typedef {object} NotifyPrefs
 * @property {boolean} friendSession       A friend finished a session.
 * @property {boolean} cheerReceived       Someone cheered one of your sessions.
 * @property {boolean} challengeInvite     You were invited to a challenge.
 * @property {boolean} challengeMilestone  A challenge reached half-way or its target.
 * @property {boolean} challengeEnded      A challenge you were in finished.
 * @property {{from: string, to: string}} quiet  `HH:MM` in the user's own time zone; nothing is delivered in between.
 */

/**
 * @returns {NotifyPrefs} Everything off, quiet from 21:00 to 08:00. A fresh object.
 */
export function defaultNotify() {
  return Object.fromEntries([...NOTIFY_KINDS.map(k => [k, false]), ['quiet', { from: '21:00', to: '08:00' }]]);
}

/**
 * Validates a partial update and merges it onto the current preferences.
 *
 * @param {unknown} input
 * @param {NotifyPrefs} current  Never modified.
 * @returns {{ok: true, value: NotifyPrefs} | {ok: false, error: string}}
 */
export function validateNotify(input, current) {
  const bad = error => ({ ok: false, error });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('notify must be an object');
  const next = { ...current, quiet: { ...current.quiet } };
  for (const [key, value] of Object.entries(input)) {
    if (NOTIFY_KINDS.includes(key)) {
      if (typeof value !== 'boolean') return bad(`notify.${key} must be true or false`);
      next[key] = value;
    } else if (key === 'quiet') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('notify.quiet must be an object');
      for (const [edge, time] of Object.entries(value)) {
        if (edge !== 'from' && edge !== 'to') return bad(`unknown quiet hours field: ${edge}`);
        if (typeof time !== 'string' || !TIME.test(time)) return bad('quiet hours must look like 21:00');
        next.quiet[edge] = time;
      }
    } else return bad(`unknown notify option: ${key}`);
  }
  return { ok: true, value: next };
}

/**
 * @param {string} hhmm  `HH:MM`.
 * @returns {number} Minutes since midnight.
 */
export function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether a time of day falls inside the quiet hours. The window may span midnight; its end is
 * the first minute a notification may be delivered, and an empty window (same start and end) means no quiet time.
 *
 * @param {{from: string, to: string}} quiet
 * @param {number} minutes  Minutes since midnight, in the user's time zone.
 * @returns {boolean}
 */
export function inQuietHours({ from, to }, minutes) {
  const a = minutesOf(from), b = minutesOf(to);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/**
 * Minutes from now until the quiet hours end.
 *
 * @param {{from: string, to: string}} quiet
 * @param {number} minutes  Minutes since midnight now.
 * @returns {number}
 */
export function minutesUntilQuietEnds({ to }, minutes) {
  return (minutesOf(to) - minutes + 1440) % 1440;
}
