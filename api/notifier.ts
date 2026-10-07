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
import { isoInZone, ownerTz } from './summary.ts';
import { isSharing } from './social.ts';
import { inQuietHours, minutesUntilQuietEnds } from './notify-prefs.ts';
import { pushText } from './push-messages.ts';
import type { MessageKey, PushText, PushVars } from './push-messages.ts';
import type { NotifyKind } from '../shared/constants.ts';
import type { SharingUser } from './social.ts';
import type { Notify, Services, User } from './types.ts';

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
 * @param ms  Epoch milliseconds.
 * @param tz  IANA zone.
 */
export function localMinutes(ms: number, tz: string): number {
  const parse = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
    return get('hour') * 60 + get('minute');
  };
  try { return parse(tz); } catch { return parse('UTC'); }
}

/** A notification ready to send. */
export interface PushMessage extends PushText {
  /** Replaces an earlier notification with the same tag. */
  tag: string
  /** Hash route the app opens when the notification is tapped. */
  url: string
}

/** The fields {@link wording} reads; which ones matter depends on the kind of event. */
export type WordingData = { names?: string[]; name?: string; emoji?: string; title?: string; stage?: string };

/**
 * The message for an event, in the recipient's language. Always encouraging; see the rules at the
 * top of this file. The wording itself lives in `push-messages.ts`.
 *
 * @param kind
 * @param data  Fields depend on the kind: `names`, `name`, `emoji`, `title`, `stage`.
 * @param lang  Language of the recipient's app; English when unknown or not translated yet.
 */
export function wording(kind: NotifyKind, data: WordingData, lang: unknown = 'en'): PushMessage {
  const url = '#/crew';
  const text = (key: MessageKey, vars: PushVars) => pushText(lang, key, vars);
  switch (kind) {
    case 'friendSession': {
      const names = data.names!;   // a friend-session event always carries the names (see `queue`)
      return { ...(names.length > 1 ? text('friendSessionMany', { n: names.length }) : text('friendSessionOne', { name: names[0] })), tag: 'social-session', url };
    }
    case 'cheerReceived':
      return { ...text('cheerReceived', data), tag: 'social-cheer', url };
    case 'challengeInvite':
      return { ...text('challengeInvite', data), tag: 'social-invite', url };
    case 'challengeMilestone':
      return { ...text(data.stage === 'half' ? 'milestoneHalf' : 'milestoneTarget', data), tag: 'social-milestone', url };
    default:
      return { ...text('challengeEnded', data), tag: 'social-ended', url };
  }
}

/** What the notifier hands back to the composition root. */
export interface Notifier {
  /** Queues a notification for a user, or declines (not sharing, kind off, no subscription). Never throws. */
  notify: Notify
  /** Delivers what is due. */
  flush: () => Promise<void>
  /** Starts the background delivery loop. */
  start: (everyMs?: number) => void
}

/**
 * @param ctx  `sendPush` is the Web Push delivery, `readState` gives the saved state (for the user's
 *   time zone and language), `now` the clock.
 */
export function createNotifier({ db, saveDb, sendPush, readState, now = Date.now }: Pick<Services, 'db' | 'saveDb' | 'readState'> & {
  sendPush: (uid: string, message: PushMessage) => Promise<void>
  now?: () => number
}): Notifier {
  const userById = (id: string) => db.users.find(u => u.id === id);
  const tzOf = (uid: string) => ownerTz(readState(uid)) || 'UTC';
  /** The language the recipient's app is set to, read at send time so a change before delivery is honoured. */
  const langOf = (uid: string): unknown => readState(uid)?.lang;
  const eligible = (user: User | undefined, kind: NotifyKind): user is SharingUser =>
    !!user && isSharing(user) && !!user.social.notify?.[kind] && db.subs.some(s => s.userId === user.id);

  /** Moves a delivery time out of quiet hours. */
  const afterQuiet = (user: SharingUser, tz: string, at: number): number => {
    const quiet = user.social.notify.quiet;
    const minutes = localMinutes(at, tz);
    if (!inQuietHours(quiet, minutes)) return at;
    return at - (at % 60000) + minutesUntilQuietEnds(quiet, minutes) * 60000;
  };

  const notify: Notify = async (uid, kind, data) => {
    try {
      return queue(uid, kind, data);
    } catch (e) {
      console.error('social notify failed', e);   // a notification must never take anything else down
      return false;
    }
  };

  /** Puts a notification in the outbox, or declines. */
  const queue = (uid: string, kind: NotifyKind, data: Record<string, unknown>): boolean => {
    const user = userById(uid);
    if (!eligible(user, kind)) return false;
    const t = now(), tz = tzOf(uid);

    if (kind === 'friendSession') {
      const day = isoInZone(t, tz);
      const waiting = db.socialOutbox.find(i => i.uid === uid && i.kind === kind && isoInZone(i.createdAt, tz) === day);
      if (waiting) {
        const names = waiting.data.names as string[];   // written just below, for every friend-session item
        if (!names.includes(data.name as string)) names.push(data.name as string);
        saveDb();
        return true;
      }
      db.socialOutbox.push({ id: crypto.randomBytes(6).toString('base64url'), uid, kind, data: { names: [data.name as string] }, createdAt: t, deliverAt: afterQuiet(user, tz, t + BATCH_MS) });
    } else {
      db.socialOutbox.push({ id: crypto.randomBytes(6).toString('base64url'), uid, kind, data, createdAt: t, deliverAt: afterQuiet(user, tz, t) });
    }
    saveDb();
    return true;
  };

  const flush = async (): Promise<void> => {
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
      try { await sendPush(item.uid, wording(item.kind, item.data as WordingData, langOf(item.uid))); } catch (e) { console.error('social push failed', e); }
    }
    if (due.length) saveDb();
  };

  /** Starts the background delivery loop. */
  const start = (everyMs = 30000): void => { setInterval(() => { flush().catch(e => console.error('push flush failed', e)); }, everyMs).unref(); };

  return { notify, flush, start };
}
