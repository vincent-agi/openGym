/**
 * Social module of the Gymme API: profile, sharing consent and (in later issues) friends and challenges.
 *
 * Design rules shared by every function here:
 * - **Private by default.** A user is invisible to everyone until they explicitly enable sharing.
 * - **Strict input.** Unknown fields are rejected rather than silently stored, so nothing
 *   unreviewed can end up in the identity store.
 * - **Pure first.** Validation is free of I/O so it can be unit tested; only
 *   {@link createSocialRoutes} touches the request/response and the identity store.
 */

import { defaultNotify, validateNotify } from './notify-prefs.js';
import { validateShowBadges } from './badges.js';

/** Handles are 3-20 characters of lowercase letters, digits and underscore. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

/** Maximum length of a display name, in characters. */
export const DISPLAY_NAME_MAX = 30;

/** Keys a user can individually choose to share with friends. */
export const SHARE_KEYS = Object.freeze(['sessions', 'streak', 'consistency', 'prs']);

const TOP_LEVEL_KEYS = Object.freeze(['enabled', 'handle', 'displayName', 'share', 'hideRank', 'notify', 'showBadges']);
// C0/C1 control characters, which have no business in a name shown to friends.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * @typedef {object} SocialSettings
 * @property {boolean} enabled      Master switch. Off means invisible to everyone.
 * @property {string}  handle       Unique, lowercase identifier used to find and add the user.
 * @property {string}  displayName  Name shown to friends.
 * @property {{sessions: boolean, streak: boolean, consistency: boolean, prs: boolean}} share
 *   Which summary fields friends may see.
 * @property {boolean} hideRank     When true the user sees lists without positions ("cheer-only mode").
 * @property {import('./notify-prefs.js').NotifyPrefs} notify  Which events may send a push notification, all off by default.
 * @property {string[]} showBadges  Earned badges friends may see; none by default.
 * @property {Array<{id: string, date: string}>} earned  Badges earned so far. Written by the server only.
 * @property {number} [cheersSent]  Server-side counter behind the Cheerleader badge; never sent to clients.
 * @property {string} [coopCompletedOn]  ISO date of the first co-op challenge finished together; server-side.
 */

/**
 * Settings of a user who never opened the module: everything private.
 *
 * @returns {SocialSettings} A fresh object, safe to mutate.
 */
export function defaultSocial() {
  return {
    enabled: false,
    handle: '',
    displayName: '',
    share: { sessions: true, streak: true, consistency: true, prs: false },
    hideRank: false,
    notify: defaultNotify(),
    showBadges: [],
    earned: [],
    cheersSent: 0
  };
}

/**
 * What a user may be told about their own settings: everything except server-side counters.
 *
 * @param {SocialSettings} social
 * @returns {Omit<SocialSettings, 'cheersSent' | 'coopCompletedOn'>}
 */
export function publicSocial(social) {
  const { cheersSent, coopCompletedOn, ...rest } = social;
  return rest;
}

/**
 * Canonical form of a handle: trimmed, lowercase, without a leading `@`.
 * Non-strings normalise to an empty string, which never passes {@link HANDLE_RE}.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHandle(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/**
 * Whether a user is currently visible to friends. The only gate every friend-facing
 * endpoint must use, so disabling sharing (or an admin disabling the account) takes effect on
 * the next request.
 *
 * @param {{social?: SocialSettings, disabled?: boolean} | null | undefined} user
 * @returns {boolean}
 */
export function isSharing(user) {
  return !!user?.social?.enabled && !user.disabled;
}

/**
 * @typedef {object} ValidationOk
 * @property {true} ok
 * @property {SocialSettings} value  The merged settings, a new object.
 */
/**
 * @typedef {object} ValidationError
 * @property {false} ok
 * @property {400 | 409} status  HTTP status the route should answer with.
 * @property {string} error      Message safe to show to the user.
 */

/**
 * Validates a partial settings update and merges it onto the current settings.
 * Never mutates `current`.
 *
 * @param {unknown} input  Parsed JSON body of `PUT /api/social/me`.
 * @param {SocialSettings} current  Settings stored today.
 * @param {{isHandleTaken: (handle: string) => boolean}} deps
 *   Reports whether another user already owns a handle.
 * @returns {ValidationOk | ValidationError}
 */
export function validateSocialUpdate(input, current, { isHandleTaken }) {
  const bad = (error, status = 400) => ({ ok: false, status, error });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('settings object required');

  const unknown = Object.keys(input).find(k => !TOP_LEVEL_KEYS.includes(k));
  if (unknown) return bad(`unknown field: ${unknown}`);

  const next = { ...current, share: { ...current.share }, notify: { ...current.notify, quiet: { ...current.notify.quiet } } };

  if ('enabled' in input) {
    if (typeof input.enabled !== 'boolean') return bad('enabled must be true or false');
    next.enabled = input.enabled;
  }
  if ('hideRank' in input) {
    if (typeof input.hideRank !== 'boolean') return bad('hideRank must be true or false');
    next.hideRank = input.hideRank;
  }
  if ('handle' in input) {
    const handle = normalizeHandle(input.handle);
    if (!HANDLE_RE.test(handle)) return bad('handle must be 3-20 characters: a-z, 0-9 or _');
    if (handle !== current.handle && isHandleTaken(handle)) return bad('that handle is already taken', 409);
    next.handle = handle;
  }
  if ('displayName' in input) {
    const name = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!name || [...name].length > DISPLAY_NAME_MAX || CONTROL_CHARS.test(name)) {
      return bad(`display name must be 1-${DISPLAY_NAME_MAX} characters, without control characters`);
    }
    next.displayName = name;
  }
  if ('share' in input) {
    const share = input.share;
    if (!share || typeof share !== 'object' || Array.isArray(share)) return bad('share must be an object');
    for (const [key, value] of Object.entries(share)) {
      if (!SHARE_KEYS.includes(key)) return bad(`unknown share option: ${key}`);
      if (typeof value !== 'boolean') return bad(`share.${key} must be true or false`);
      next.share[key] = value;
    }
  }
  if ('showBadges' in input) {
    const checked = validateShowBadges(input.showBadges);
    if (!checked.ok) return bad(checked.error);
    next.showBadges = checked.value;
  }
  if ('notify' in input) {
    const checked = validateNotify(input.notify, current.notify);
    if (!checked.ok) return bad(checked.error);
    next.notify = checked.value;
  }

  if (next.enabled && (!next.handle || !next.displayName)) {
    return bad('choose a handle and a display name before enabling sharing');
  }
  return { ok: true, value: next };
}

/**
 * Resolves the caller of a friend-facing route: signed in, and sharing. Answers 401 / 403 itself.
 *
 * @param {(req: import('node:http').IncomingMessage) => (object | null)} readSession
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} json
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {object | null} The user, or null when a response was already sent.
 */
export function requireSharing(readSession, json, req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isSharing(user)) { json(res, 403, { error: 'turn on sharing first' }); return null; }
  return user;
}

/**
 * Builds the `/api/social/*` route table.
 *
 * Routes are only registered when the instance enabled the module, so a disabled instance
 * answers 404 exactly as if the feature did not exist.
 *
 * @param {object} ctx  Server services, injected to keep this module free of globals.
 * @param {{users: Array<{id: string, social?: SocialSettings}>}} ctx.db  Identity store (mutated in place).
 * @param {() => void} ctx.saveDb  Persists the identity store atomically.
 * @param {(req: import('node:http').IncomingMessage) => ({id: string, social?: SocialSettings} | null)} ctx.readSession
 *   Resolves the signed-in user, or null.
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} ctx.json  JSON responder.
 * @param {(req: import('node:http').IncomingMessage) => Promise<any>} ctx.readBody  JSON body reader.
 * @param {(user: object, wasSharing: boolean) => void} [ctx.onChange]  Called after settings were saved,
 *   with whether the user was sharing *before* the change.
 * @returns {Record<string, (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>>}
 */
export function createSocialRoutes({ db, saveDb, readSession, json, readBody, onChange = () => {} }) {
  /** @param {{social?: SocialSettings}} user */
  const settingsOf = user => ({ ...defaultSocial(), ...(user.social || {}) });

  return {
    'GET /api/social/me': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      json(res, 200, { social: publicSocial(settingsOf(user)) });
    },

    'PUT /api/social/me': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'not signed in' });
      const body = await readBody(req);
      const result = validateSocialUpdate(body, settingsOf(user), {
        isHandleTaken: handle => db.users.some(u => u.id !== user.id && u.social?.handle === handle)
      });
      if (!result.ok) return json(res, result.status, { error: result.error });
      const wasSharing = isSharing(user);
      user.social = result.value;
      saveDb();
      onChange(user, wasSharing);
      json(res, 200, { social: publicSocial(user.social) });
    }
  };
}
