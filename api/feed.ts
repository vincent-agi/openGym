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
import { CHEER_EMOJI } from '../shared/constants.ts';
import type { CheerEmoji } from '../shared/constants.ts';
import type { StateDoc } from './types.ts';
import { addDays, isoInZone, isSession, sessionLimit } from './summary.js';

// The only cheers that exist. They live in shared/constants.ts, read by the frontend too.
export { CHEER_EMOJI };

/** Events (and the cheers on them) are forgotten after this many days. */
export const EVENT_TTL_DAYS = 30;

/** Only sessions this recent are news; older ones are history and must not flood a friend's feed on first sync. */
const FRESH_DAYS = 2;

/** A session found in a saved state; `ref` is internal and never sent to friends. */
export interface NewEvent { ref: string; date: string }

/** Outcome of {@link validateCheer}. */
export type CheerValidation = { ok: true; value: { eventId: string; emoji: CheerEmoji } } | { ok: false };

const isCheerEmoji = (value: unknown): value is CheerEmoji => (CHEER_EMOJI as readonly unknown[]).includes(value);

/**
 * Validates the body of `POST /api/social/cheer`.
 *
 * @param input
 */
export function validateCheer(input: unknown): CheerValidation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false };
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('eventId') || !keys.includes('emoji')) return { ok: false };
  const { eventId, emoji } = input as Record<string, unknown>;
  if (typeof eventId !== 'string' || !eventId || !isCheerEmoji(emoji)) return { ok: false };
  return { ok: true, value: { eventId, emoji } };
}

/**
 * Finds sessions in a saved state that have not produced an event yet.
 *
 * @param state  The user's synced state; never modified.
 * @param now    Epoch ms.
 * @param tz     The owner's IANA time zone if known.
 * @param seen   References of events already recorded for this user.
 * @returns The new events; `ref` is internal and never sent to friends.
 */
export function newEventsFromState(state: StateDoc | null | undefined, now: number, tz: string | null | undefined, seen: Set<string>): NewEvent[] {
  const today = isoInZone(now, tz || 'UTC');
  const limit = sessionLimit(today, tz);
  const since = addDays(today, -(FRESH_DAYS - 1));
  const out: NewEvent[] = [];
  const taken = new Set(seen);
  for (const w of Array.isArray(state?.workouts) ? state.workouts : []) {
    if (!isSession(w, limit) || w.d < since) continue;
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
 * @param events
 * @param cheers
 * @param now
 */
export function pruneFeed<E extends { id: string; createdAt: number }, C extends { eventId: string }>(events: E[], cheers: C[], now: number): { events: E[]; cheers: C[] } {
  const keep = events.filter(e => e.createdAt > now - EVENT_TTL_DAYS * 86400000);
  const ids = new Set(keep.map(e => e.id));
  return { events: keep, cheers: cheers.filter(c => ids.has(c.eventId)) };
}

/**
 * Groups cheers by emoji, in the order of the whitelist.
 *
 * @param cheers
 */
export function countCheers(cheers: Array<{ emoji: string }>): Array<{ emoji: CheerEmoji; count: number }> {
  return CHEER_EMOJI
    .map(emoji => ({ emoji, count: cheers.filter(c => c.emoji === emoji).length }))
    .filter(g => g.count > 0);
}
