// Friends — client-side helpers for friend codes and links.
//
// Pure functions (storage is injected) so they can be unit tested. The server owns every
// rule that matters; these only turn what a person types or pastes into a request body.

import { HANDLE_RE, normalizeHandle } from './social.js'

/** Same alphabet as the API: no 0 O 1 I L, so a code survives being read aloud. */
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{10}$/

const PENDING_KEY = 'gymme_pending_friend_code'

/**
 * Link a friend can open to send you a request. Uses the hash router, like every other route.
 *
 * @param {string} code    Friend code.
 * @param {string} origin  Page URL the app is served from, e.g. `location.origin + location.pathname`.
 * @returns {string}
 */
export function friendLink(code, origin) {
  return `${origin.replace(/\/+$/, '')}/#/friend/${code}`
}

/**
 * Reads a friend code from a bare code or a pasted friend link.
 *
 * @param {unknown} input  Text typed or pasted by the user.
 * @returns {string | null} The code in upper case, or null when the text is not a code.
 */
export function extractFriendCode(input) {
  if (typeof input !== 'string') return null
  const fromLink = input.match(/#\/friend\/([^/?#\s]+)/i)
  const cleaned = (fromLink ? fromLink[1] : input).replace(/[\s-]/g, '').toUpperCase()
  return CODE_RE.test(cleaned) ? cleaned : null
}

/**
 * Turns the text of the "add a friend" field into the request bodies to try, in order.
 * A link is always a code and `@name` is always a handle; plain text that could be either is
 * tried as a code first, then as a handle.
 *
 * @param {string} input
 * @returns {Array<{code: string} | {handle: string}>} Empty when the text is neither.
 */
export function addRequestBodies(input) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text) return []
  if (text.includes('/')) {
    const code = extractFriendCode(text)
    return code ? [{ code }] : []
  }
  const bodies = []
  const handle = normalizeHandle(text)
  const code = text.startsWith('@') ? null : extractFriendCode(text)
  if (code) bodies.push({ code })
  if (HANDLE_RE.test(handle)) bodies.push({ handle })
  return bodies
}

/**
 * Remembers a code from a friend link so it can be redeemed once the user has turned sharing on.
 * Failures (private mode, quota) are swallowed: losing the hint is better than a broken page.
 *
 * @param {string} code
 * @param {Pick<Storage, 'setItem'>} [storage]
 */
export function rememberPendingCode(code, storage = globalThis.localStorage) {
  try { if (extractFriendCode(code)) storage.setItem(PENDING_KEY, extractFriendCode(code)) } catch { /* ignore */ }
}

/**
 * Returns the remembered code, if any, and forgets it.
 *
 * @param {Pick<Storage, 'getItem' | 'removeItem'>} [storage]
 * @returns {string | null}
 */
export function takePendingCode(storage = globalThis.localStorage) {
  try {
    const code = storage.getItem(PENDING_KEY)
    storage.removeItem(PENDING_KEY)
    return extractFriendCode(code)
  } catch { return null }
}
