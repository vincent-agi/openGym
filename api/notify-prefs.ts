/**
 * Notification preferences of the social module: which events may reach a user, and the hours
 * when nothing should. Pure data and validation, no dependencies.
 *
 * Everything starts **off**; a user is only ever pinged about something they asked for.
 */

import { NOTIFY_KINDS } from '../shared/constants.ts';
import type { NotifyKind } from '../shared/constants.ts';
import type { NotifyPrefs, QuietHours } from '../shared/social.ts';

// The events a user can opt in to live in shared/constants.ts (the Settings screen lists the same ones).
export { NOTIFY_KINDS };
export type { NotifyPrefs, QuietHours };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Outcome of {@link validateNotify}: the merged preferences, or why the input was refused. */
export type NotifyValidation = { ok: true; value: NotifyPrefs } | { ok: false; error: string };

const isNotifyKind = (key: string): key is NotifyKind => (NOTIFY_KINDS as readonly string[]).includes(key);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * @returns Everything off, quiet from 21:00 to 08:00. A fresh object.
 */
export function defaultNotify(): NotifyPrefs {
  return Object.fromEntries([...NOTIFY_KINDS.map(k => [k, false]), ['quiet', { from: '21:00', to: '08:00' }]]) as NotifyPrefs;
}

/**
 * Validates a partial update and merges it onto the current preferences.
 *
 * @param input
 * @param current  Never modified.
 */
export function validateNotify(input: unknown, current: NotifyPrefs): NotifyValidation {
  const bad = (error: string): NotifyValidation => ({ ok: false, error });
  if (!isPlainObject(input)) return bad('notify must be an object');
  const next: NotifyPrefs = { ...current, quiet: { ...current.quiet } };
  for (const [key, value] of Object.entries(input)) {
    if (isNotifyKind(key)) {
      if (typeof value !== 'boolean') return bad(`notify.${key} must be true or false`);
      next[key] = value;
    } else if (key === 'quiet') {
      if (!isPlainObject(value)) return bad('notify.quiet must be an object');
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
 * @param hhmm  `HH:MM`.
 * @returns Minutes since midnight.
 */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

/**
 * Whether a time of day falls inside the quiet hours. The window may span midnight; its end is
 * the first minute a notification may be delivered, and an empty window (same start and end) means no quiet time.
 *
 * @param quiet
 * @param minutes  Minutes since midnight, in the user's time zone.
 */
export function inQuietHours({ from, to }: QuietHours, minutes: number): boolean {
  const a = minutesOf(from), b = minutesOf(to);
  if (a === b) return false;
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
}

/**
 * Minutes from now until the quiet hours end.
 *
 * @param quiet
 * @param minutes  Minutes since midnight now.
 */
export function minutesUntilQuietEnds({ to }: QuietHours, minutes: number): number {
  return (minutesOf(to) - minutes + 1440) % 1440;
}
