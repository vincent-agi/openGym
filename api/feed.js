/**
 * Activity feed and cheers: the lightest possible way for friends to notice each other.
 *
 * - An **event** says only that someone finished a session on a date. It never carries a routine,
 *   an exercise, a weight or a duration.
 * - A **cheer** is one emoji from a fixed list. There is no free text anywhere, so nothing a
 *   cheer says can turn unkind.
 *
 * Events are derived on the server from the state it already receives, so a client cannot forge
 * one for somebody else.
 */
import { addDays, isoInZone, isSession } from './summary.js';

/** The only cheers that exist. Mirrored in `frontend/src/lib/cheers.js`; a test keeps both equal. */
export const CHEER_EMOJI = Object.freeze(['👏', '🔥', '💪', '🎉', '❤️']);

/** Events (and the cheers on them) are forgotten after this many days. */
export const EVENT_TTL_DAYS = 30;

/** Only sessions this recent are news; older ones are history and must not flood a friend's feed on first sync. */
const FRESH_DAYS = 2;

/**
 * Validates the body of `POST /api/social/cheer`.
 *
 * @param {unknown} input
 * @returns {{ok: true, value: {eventId: string, emoji: string}} | {ok: false}}
 */
export function validateCheer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('eventId') || !keys.includes('emoji')) return { ok: false };
  const { eventId, emoji } = input;
  if (typeof eventId !== 'string' || !eventId || !CHEER_EMOJI.includes(emoji)) return { ok: false };
  return { ok: true, value: { eventId, emoji } };
}

/**
 * Finds sessions in a saved state that have not produced an event yet.
 *
 * @param {object} state  The user's synced state; never modified.
 * @param {number} now    Epoch ms.
 * @param {string} tz     The owner's IANA time zone.
 * @param {Set<string>} seen  References of events already recorded for this user.
 * @returns {Array<{ref: string, date: string}>}  `ref` is internal and never sent to friends.
 */
export function newEventsFromState(state, now, tz, seen) {
  const today = isoInZone(now, tz);
  const since = addDays(today, -(FRESH_DAYS - 1));
  const out = [];
  const taken = new Set(seen);
  for (const w of Array.isArray(state?.workouts) ? state.workouts : []) {
    if (!isSession(w, today) || w.d < since) continue;
    const ref = w.id != null ? String(w.id) : `day:${w.d}`;
    if (taken.has(ref)) continue;
    taken.add(ref);
    out.push({ ref, date: w.d });
  }
  return out;
}

/**
 * Forgets old events, and the cheers that pointed at them.
 *
 * @param {Array<{id: string, createdAt: number}>} events
 * @param {Array<{eventId: string}>} cheers
 * @param {number} now
 * @returns {{events: object[], cheers: object[]}}
 */
export function pruneFeed(events, cheers, now) {
  const keep = events.filter(e => e.createdAt > now - EVENT_TTL_DAYS * 86400000);
  const ids = new Set(keep.map(e => e.id));
  return { events: keep, cheers: cheers.filter(c => ids.has(c.eventId)) };
}

/**
 * Groups cheers by emoji, in the order of the whitelist.
 *
 * @param {Array<{emoji: string}>} cheers
 * @returns {Array<{emoji: string, count: number}>}
 */
export function countCheers(cheers) {
  return CHEER_EMOJI
    .map(emoji => ({ emoji, count: cheers.filter(c => c.emoji === emoji).length }))
    .filter(g => g.count > 0);
}
