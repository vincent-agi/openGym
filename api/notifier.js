/**
 * Opt-in push notifications for the social module.
 *
 * The rules, in order of importance:
 * 1. **Only what you asked for.** Every kind is off by default and tied to a preference; a user who
 *    is not sharing, or has no push subscription, receives nothing.
 * 2. **Never at night.** Pushes inside the recipient's quiet hours (in *their* time zone) are held
 *    until the hours end, and dropped if that would make them more than 12 hours stale.
 * 3. **Never a flood.** At most one friend-session push and three social pushes per recipient
 *    per day. Friends who train close together are merged into one digest.
 * 4. **Always kind.** Wording celebrates; it never compares, ranks or says anyone is behind.
 *
 * Pushes go through a small persistent outbox (`db.socialOutbox`) so deferrals survive a restart.
 */
import crypto from 'node:crypto';
import { isoInZone, ownerTz } from './summary.js';
import { isSharing } from './social.js';
import { inQuietHours, minutesUntilQuietEnds } from './notify-prefs.js';

/** Social pushes one recipient can get in a day. */
export const DAILY_CAP = 3;

/** How long a friend-session push waits so that several friends can be merged into one. */
export const BATCH_MS = 10 * 60000;

/** A held push older than this is dropped rather than delivered stale. */
export const MAX_DEFER_MS = 12 * 3600000;

const LOG_KEEP_MS = 2 * 86400000;

/**
 * Minutes since midnight at an instant, in a time zone. An unknown zone falls back to UTC.
 *
 * @param {number} ms
 * @param {string} tz  IANA zone.
 * @returns {number}
 */
export function localMinutes(ms, tz) {
  const parse = zone => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
    const get = type => Number(parts.find(p => p.type === type).value);
    return get('hour') * 60 + get('minute');
  };
  try { return parse(tz); } catch { return parse('UTC'); }
}

/**
 * @typedef {object} PushMessage
 * @property {string} title
 * @property {string} body
 * @property {string} tag   Replaces an earlier notification with the same tag.
 * @property {string} url   Hash route the app opens when the notification is tapped.
 */

/**
 * The message for an event. Always encouraging; see the rules at the top of this file.
 *
 * @param {'friendSession'|'cheerReceived'|'challengeInvite'|'challengeMilestone'|'challengeEnded'} kind
 * @param {object} data  Fields depend on the kind: `names`, `name`, `emoji`, `title`, `stage`.
 * @returns {PushMessage}
 */
export function wording(kind, data) {
  const url = '#/crew';
  switch (kind) {
    case 'friendSession':
      return data.names.length > 1
        ? { title: `${data.names.length} friends trained today`, body: 'Your crew is on a roll. Send a cheer 👏', tag: 'social-session', url }
        : { title: `${data.names[0]} finished a session`, body: 'Send a cheer 👏', tag: 'social-session', url };
    case 'cheerReceived':
      return { title: `${data.name} cheered your session ${data.emoji}`, body: 'Nice work 💪', tag: 'social-cheer', url };
    case 'challengeInvite':
      return { title: `${data.name} invited you to "${data.title}"`, body: 'Join whenever you are ready.', tag: 'social-invite', url };
    case 'challengeMilestone':
      return data.stage === 'half'
        ? { title: 'Halfway there!', body: `"${data.title}" is half done. Keep it going.`, tag: 'social-milestone', url }
        : { title: 'Target reached 🎉', body: `"${data.title}": well played!`, tag: 'social-milestone', url };
    default:
      return { title: `"${data.title}" is over`, body: 'Thanks for taking part. See the results.', tag: 'social-ended', url };
  }
}

/**
 * @param {object} ctx
 * @param {{users: object[], subs: object[], socialOutbox: object[], socialPushLog: object[]}} ctx.db
 * @param {() => void} ctx.saveDb
 * @param {(uid: string, message: PushMessage) => Promise<void>} ctx.sendPush  Web Push delivery.
 * @param {(uid: string) => (object | null)} ctx.readState  Saved state, for the user's time zone.
 * @param {() => number} [ctx.now]
 * @returns {{
 *   notify: (uid: string, kind: string, data: object) => Promise<boolean>,
 *   flush: () => Promise<void>,
 *   start: (everyMs?: number) => void
 * }}
 */
export function createNotifier({ db, saveDb, sendPush, readState, now = Date.now }) {
  const userById = id => db.users.find(u => u.id === id);
  const tzOf = uid => ownerTz(readState(uid)) || 'UTC';
  const eligible = (user, kind) => !!user && isSharing(user) && !!user.social.notify?.[kind] && db.subs.some(s => s.userId === user.id);

  /** Moves a delivery time out of quiet hours. */
  const afterQuiet = (user, tz, at) => {
    const quiet = user.social.notify.quiet;
    const minutes = localMinutes(at, tz);
    if (!inQuietHours(quiet, minutes)) return at;
    return at - (at % 60000) + minutesUntilQuietEnds(quiet, minutes) * 60000;
  };

  const notify = async (uid, kind, data) => {
    try {
      return queue(uid, kind, data);
    } catch (e) {
      console.error('social notify failed', e);   // a notification must never take anything else down
      return false;
    }
  };

  /** Puts a notification in the outbox, or declines. */
  const queue = (uid, kind, data) => {
    const user = userById(uid);
    if (!eligible(user, kind)) return false;
    const t = now(), tz = tzOf(uid);

    if (kind === 'friendSession') {
      const day = isoInZone(t, tz);
      const waiting = db.socialOutbox.find(i => i.uid === uid && i.kind === kind && isoInZone(i.createdAt, tz) === day);
      if (waiting) {
        if (!waiting.data.names.includes(data.name)) waiting.data.names.push(data.name);
        saveDb();
        return true;
      }
      db.socialOutbox.push({ id: crypto.randomBytes(6).toString('base64url'), uid, kind, data: { names: [data.name] }, createdAt: t, deliverAt: afterQuiet(user, tz, t + BATCH_MS) });
    } else {
      db.socialOutbox.push({ id: crypto.randomBytes(6).toString('base64url'), uid, kind, data, createdAt: t, deliverAt: afterQuiet(user, tz, t) });
    }
    saveDb();
    return true;
  };

  const flush = async () => {
    const t = now();
    const due = db.socialOutbox.filter(i => i.deliverAt <= t);
    db.socialOutbox = db.socialOutbox.filter(i => i.deliverAt > t);
    db.socialPushLog = db.socialPushLog.filter(l => l.ts > t - LOG_KEEP_MS);

    for (const item of due) {
      const user = userById(item.uid);
      if (!eligible(user, item.kind) || t - item.createdAt > MAX_DEFER_MS) continue;
      const tz = tzOf(item.uid);
      const resume = afterQuiet(user, tz, t);
      if (resume > t) { db.socialOutbox.push({ ...item, deliverAt: resume }); continue; }

      const day = isoInZone(t, tz);
      const today = db.socialPushLog.filter(l => l.uid === item.uid && l.date === day);
      if (today.length >= DAILY_CAP || (item.kind === 'friendSession' && today.some(l => l.kind === 'friendSession'))) continue;

      db.socialPushLog.push({ uid: item.uid, kind: item.kind, ts: t, date: day });
      try { await sendPush(item.uid, wording(item.kind, item.data)); } catch (e) { console.error('social push failed', e); }
    }
    if (due.length) saveDb();
  };

  /** Starts the background delivery loop. @param {number} [everyMs] */
  const start = (everyMs = 30000) => { setInterval(() => { flush().catch(e => console.error('push flush failed', e)); }, everyMs).unref(); };

  return { notify, flush, start };
}
