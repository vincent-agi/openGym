// Friends & challenges — client-side rules shared by the Settings screen and later by the Crew screen.
//
// Everything here is pure (no store, no network) so it can be unit tested. The server
// (api/social.js) re-validates every value; these helpers only exist to give feedback before
// a request is made and to describe, honestly, what a friend would be able to see.

/** Handles are 3-20 characters of lowercase letters, digits and underscore. Mirrors the API. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/

/** Longest display name, in characters. Mirrors the API. */
export const DISPLAY_NAME_MAX = 30

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

/**
 * @typedef {object} SocialSettings
 * @property {boolean} enabled      Master switch; off means invisible to everyone.
 * @property {string}  handle       Unique lowercase identifier.
 * @property {string}  displayName  Name shown to friends.
 * @property {{sessions: boolean, streak: boolean, consistency: boolean, prs: boolean}} share
 * @property {boolean} hideRank     Show lists without positions ("cheer-only mode").
 * @property {{friendSession: boolean, cheerReceived: boolean, challengeInvite: boolean, challengeMilestone: boolean, challengeEnded: boolean, quiet: {from: string, to: string}}} notify
 *   Which events may send a push notification (all off by default) and the quiet hours.
 */

/** Settings of a user who never opened the module. Treat as read-only; spread to copy. */
export const EMPTY_SOCIAL = Object.freeze({
  enabled: false,
  handle: '',
  displayName: '',
  share: Object.freeze({ sessions: true, streak: true, consistency: true, prs: false }),
  hideRank: false,
  notify: Object.freeze({
    friendSession: false, cheerReceived: false, challengeInvite: false, challengeMilestone: false, challengeEnded: false,
    quiet: Object.freeze({ from: '21:00', to: '08:00' })
  })
})

/**
 * Canonical form of a handle: trimmed, lowercase, no leading `@`.
 *
 * @param {unknown} raw
 * @returns {string} Empty for anything that is not a string.
 */
export function normalizeHandle(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/^@/, '').toLowerCase() : ''
}

/**
 * Explains why a handle is not acceptable.
 *
 * @param {string} raw  What the user typed.
 * @returns {string | null} A message ready for `t()`, or null when the handle is fine.
 */
export function handleError(raw) {
  return HANDLE_RE.test(normalizeHandle(raw)) ? null : 'Use 3-20 characters: letters a-z, digits or _'
}

/**
 * Explains why a display name is not acceptable.
 *
 * @param {string} raw  What the user typed.
 * @returns {string | null} A message ready for `t()`, or null when the name is fine.
 */
export function displayNameError(raw) {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name || [...name].length > DISPLAY_NAME_MAX || CONTROL_CHARS.test(name)) {
    return 'Use 1-30 characters, no special control characters'
  }
  return null
}

/**
 * Whether the master switch may be turned on: both identity fields must be valid.
 *
 * @param {SocialSettings} social
 * @returns {boolean}
 */
export function canEnableSharing(social) {
  return !handleError(social.handle) && !displayNameError(social.displayName)
}

// Display order of the shareable fields, and a made-up value to render in the preview.
const FIELDS = [
  { key: 'sessions', example: '3' },
  { key: 'consistency', example: '75%' },
  { key: 'streak', example: '4' },
  { key: 'prs', example: '2' }
]

/**
 * What a friend would see about this user. The preview card renders exactly this list, so
 * the screen can never promise less, or more, than what is actually shared.
 *
 * @param {SocialSettings} social
 * @returns {Array<{key: 'sessions'|'consistency'|'streak'|'prs', example: string}>}
 *   Empty while sharing is off.
 */
export function sharedFields(social) {
  if (!social.enabled) return []
  return FIELDS.filter(f => social.share[f.key])
}

/**
 * The notification switches shown in Settings, in the order the API lists them.
 * Strings are English keys for `t()`.
 */
export const NOTIFY_OPTIONS = [
  { key: 'friendSession', title: 'A friend trained', subtitle: 'At most one a day. Friends who train close together are grouped.' },
  { key: 'cheerReceived', title: 'Someone cheered you', subtitle: 'When a friend sends a cheer on your session.' },
  { key: 'challengeInvite', title: 'Challenge invitations', subtitle: 'When a friend invites you to a challenge.' },
  { key: 'challengeMilestone', title: 'Challenge milestones', subtitle: 'Halfway there, and when the target is reached.' },
  { key: 'challengeEnded', title: 'Challenge results', subtitle: 'When a challenge you were in is over.' }
]

/** Hours offered for the start and end of the quiet hours. */
export const QUIET_HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0') + ':00')

/**
 * The quiet hours as a sentence template for `t()`.
 *
 * @param {{from: string, to: string}} quiet
 * @returns {{template: string, from: string, to: string}}
 */
export const quietLabel = quiet => ({ template: 'No notifications from {0} to {1}', from: quiet.from, to: quiet.to })
