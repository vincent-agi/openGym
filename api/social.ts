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

import type { IncomingMessage, ServerResponse } from 'node:http';
import { HANDLE_RE, DISPLAY_NAME_MAX, SHARE_KEYS } from '../shared/constants.ts';
import type { ShareKey } from '../shared/constants.ts';
import type { SocialSettings } from '../shared/social.ts';
import { defaultNotify, validateNotify } from './notify-prefs.ts';
import { validateShowBadges } from './badges.ts';
import type { Db, JsonResponder, Routes, Services, SocialHooks, StoredSocial, User } from './types.ts';

export type { SocialSettings };

/** Outcome of {@link validateSocialUpdate}. */
export type SocialValidation =
  | { ok: true; value: StoredSocial }
  /** `status` is the HTTP status the route should answer with; `error` is safe to show to the user. */
  | { ok: false; status: 400 | 409; error: string };

const isShareKey = (key: string): key is ShareKey => (SHARE_KEYS as readonly string[]).includes(key);

// Handle format, display name length and the share switches live in shared/constants.ts, where the
// Settings screen reads them too.
export { HANDLE_RE, DISPLAY_NAME_MAX, SHARE_KEYS };

const TOP_LEVEL_KEYS = Object.freeze(['enabled', 'handle', 'displayName', 'share', 'hideRank', 'notify', 'showBadges']);
// C0/C1 control characters, which have no business in a name shown to friends.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Settings of a user who never opened the module: everything private.
 *
 * @returns A fresh object, safe to mutate.
 */
export function defaultSocial(): StoredSocial {
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
 * @param social
 */
export function publicSocial(social: StoredSocial): SocialSettings {
  const { cheersSent, coopCompletedOn, ...rest } = social;
  return rest;
}

/**
 * Canonical form of a handle: trimmed, lowercase, without a leading `@`.
 * Non-strings normalise to an empty string, which never passes {@link HANDLE_RE}.
 *
 * @param raw
 */
export function normalizeHandle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/**
 * Whether a user is currently visible to friends. The only gate every friend-facing
 * endpoint must use, so disabling sharing (or an admin disabling the account) takes effect on
 * the next request.
 *
 * @param user
 */
export function isSharing(user: Pick<User, 'social' | 'disabled'> | null | undefined): boolean {
  return !!user?.social?.enabled && !user.disabled;
}

/**
 * Validates a partial settings update and merges it onto the current settings.
 * Never mutates `current`.
 *
 * @param body  Parsed JSON body of `PUT /api/social/me`.
 * @param current  Settings stored today.
 * @param deps  `isHandleTaken` reports whether another user already owns a handle.
 * @returns The merged settings (a new object), or the error to answer with.
 */
export function validateSocialUpdate(body: unknown, current: StoredSocial, { isHandleTaken }: { isHandleTaken: (handle: string) => boolean }): SocialValidation {
  const bad = (error: string, status: 400 | 409 = 400): SocialValidation => ({ ok: false, status, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('settings object required');
  const input = body as Record<string, unknown>;

  const unknown = Object.keys(input).find(k => !TOP_LEVEL_KEYS.includes(k));
  if (unknown) return bad(`unknown field: ${unknown}`);

  const next: StoredSocial = { ...current, share: { ...current.share }, notify: { ...current.notify, quiet: { ...current.notify.quiet } } };

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
      if (!isShareKey(key)) return bad(`unknown share option: ${key}`);
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
 * @param readSession
 * @param json
 * @param req
 * @param res
 * @returns The user, or null when a response was already sent.
 */
export function requireSharing(readSession: Services['readSession'], json: JsonResponder, req: IncomingMessage, res: ServerResponse): User | null {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isSharing(user)) { json(res, 403, { error: 'turn on sharing first' }); return null; }
  return user;
}

/** What {@link createSocialRoutes} needs from the server. */
export interface SocialRouteDeps extends Pick<Services, 'saveDb' | 'readSession' | 'json' | 'readBody'> {
  db: Pick<Db, 'users'>
  onChange?: SocialHooks['onChange']
}

/**
 * Builds the `/api/social/*` route table.
 *
 * Routes are only registered when the instance enabled the module, so a disabled instance
 * answers 404 exactly as if the feature did not exist.
 *
 * @param ctx  Server services, injected to keep this module free of globals. `db` is the identity
 *   store (mutated in place), `saveDb` persists it atomically, `readSession` resolves the signed-in
 *   user (or null), and `onChange` is called after settings were saved, with whether the user was
 *   sharing *before* the change.
 */
export function createSocialRoutes({ db, saveDb, readSession, json, readBody, onChange = () => {} }: SocialRouteDeps): Routes {
  const settingsOf = (user: Pick<User, 'social'>): StoredSocial => ({ ...defaultSocial(), ...(user.social || {}) });

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
      try { onChange(user, wasSharing); } catch (e) { console.error('social follow-up failed after a settings change', e); }
      json(res, 200, { social: publicSocial(user.social) });
    }
  };
}
