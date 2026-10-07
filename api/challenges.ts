/**
 * Friendly challenges: a shared goal over a few weeks, either **versus** (everyone chases the
 * same target and the list is ranked) or **co-op** (everyone's progress adds up to one target).
 *
 * Like the rest of the social module, the rules are pure functions over plain data so they can be
 * unit tested; {@link createChallengeService} adapts them to storage and HTTP. Progress is always
 * derived on the server from a user's own saved state, never accepted from a client.
 */
import { CHALLENGE_LIMITS, CHALLENGE_TYPES, CHALLENGE_MODES } from '../shared/constants.ts';
import type { ChallengeMode, ChallengeType } from '../shared/constants.ts';
import type { ChallengeStatus, ChallengeView, CreateChallengeBody, ParticipantView } from '../shared/social.ts';
import { addDays, mondayOf, isSession, isPlanned } from './summary.ts';
import type { Session } from './summary.ts';
import type { Challenge, ChallengeProgress, StateDoc } from './types.ts';
import { isSharing, normalizeHandle } from './social.ts';

import crypto from 'node:crypto';

// Limits, challenge types and modes live in shared/constants.ts, where the creation form reads them too.
export const LIMITS = CHALLENGE_LIMITS;
export const TYPES = CHALLENGE_TYPES;
export const MODES = CHALLENGE_MODES;

/** Body of `POST /api/social/challenges`, once validated. */
export type ChallengeInput = CreateChallengeBody;

/** Outcome of {@link validateChallengeInput}. */
export type ChallengeValidation = { ok: true; value: ChallengeInput } | { ok: false; error: string };

/** One person's progress inside a challenge window; see {@link collectProgress}. */
export type Progress = ChallengeProgress;

/** The dates and status every rule about the life of a challenge reads. */
interface Lifespan { startDate: string; endDate: string; status?: string }

const FIELDS = ['title', 'type', 'mode', 'target', 'startDate', 'endDate', 'invite'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (s: unknown): s is string => typeof s === 'string' && ISO_DAY.test(s) && addDays(s, 0) === s;
const isType = (value: unknown): value is ChallengeType => (TYPES as readonly unknown[]).includes(value);
const isMode = (value: unknown): value is ChallengeMode => (MODES as readonly unknown[]).includes(value);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/**
 * Validates the body of `POST /api/social/challenges`.
 *
 * @param input
 * @param ctx  `today` is today's date, ISO, in the caller's frame of reference.
 */
export function validateChallengeInput(input: unknown, { today }: { today: string }): ChallengeValidation {
  const bad = (error: string): ChallengeValidation => ({ ok: false, error });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('challenge required');
  const fields = input as Record<string, unknown>;
  const unknown = Object.keys(fields).find(k => !FIELDS.includes(k));
  if (unknown) return bad(`unknown field: ${unknown}`);

  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  if (!title || [...title].length > LIMITS.titleMax) return bad(`title must be 1-${LIMITS.titleMax} characters`);
  const { type, mode, target, startDate, endDate } = fields;
  if (!isType(type)) return bad('unknown challenge type');
  if (!isMode(mode)) return bad('unknown challenge mode');
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 1 || target > LIMITS.maxTarget) return bad(`target must be a whole number from 1 to ${LIMITS.maxTarget}`);
  if (!isValidDate(startDate) || !isValidDate(endDate)) return bad('dates must look like 2026-10-07');
  if (startDate < today) return bad('a challenge cannot start in the past');
  const days = daysBetween(startDate, endDate) + 1;
  if (days < LIMITS.minDays || days > LIMITS.maxDays) return bad(`a challenge lasts ${LIMITS.minDays} to ${LIMITS.maxDays} days`);

  const invite: string[] = [...new Set((Array.isArray(fields.invite) ? fields.invite : []).map(normalizeHandle).filter(Boolean))];
  if (invite.length < LIMITS.minParticipants - 1) return bad('invite at least one friend');
  if (invite.length > LIMITS.maxParticipants - 1) return bad(`at most ${LIMITS.maxParticipants} people can take part`);

  return { ok: true, value: { title, type, mode, target, startDate, endDate, invite } };
}

/**
 * Reads one person's progress inside a window from their saved state.
 *
 * @param state  The user's synced state; never modified.
 * @param win
 *   `from`/`to` bound the challenge for this person (late joiners start later); `gaps` are
 *   periods when sharing was off, which never count.
 * @returns Every Monday-based week touching the window in `weeks`; `full` means the whole week is inside it.
 */
export function collectProgress(
  state: StateDoc | null | undefined,
  { from, to, today, gaps }: { from: string; to: string; today: string; gaps: Array<{ from: string; to: string }> }
): Progress {
  const end = to < today ? to : today;
  const inGap = (d: string) => gaps.some(g => d >= g.from && d <= g.to);
  const counted = (Array.isArray(state?.workouts) ? (state.workouts as unknown[]) : [])
    .filter((w): w is Session => isSession(w, today))
    .filter(w => w.d >= from && w.d <= end && !inGap(w.d));

  const weeks: Progress['weeks'] = [];
  for (let start = mondayOf(from); start <= end; start = addDays(start, 7)) {
    const last = addDays(start, 6);
    let planned = 0;
    for (let i = 0; i < 7; i++) if (isPlanned(state || {}, addDays(start, i))) planned++;
    weeks.push({
      start, planned,
      sessions: counted.filter(w => w.d >= start && w.d <= last).length,
      full: start >= from && last <= to
    });
  }
  return { sessions: counted.length, days: [...new Set(counted.map(w => w.d))].sort(), weeks };
}

/**
 * The number a challenge type counts, given someone's progress.
 *
 * @param type
 * @param data  Missing for someone who has not synced yet.
 */
export function progressOf(type: ChallengeType, data: Progress | undefined): number {
  if (!data) return 0;
  if (type === 'sessions') return data.sessions;
  if (type === 'activeDays') return data.days.length;
  if (type === 'consistency') return data.weeks.filter(w => w.full && w.planned > 0 && w.sessions >= w.planned).length;
  let best = 0, run = 0, prev: string | null = null;       // streak: longest run of consecutive weeks with a session
  for (const w of data.weeks) {
    if (w.sessions > 0) { run = prev && addDays(prev, 7) === w.start ? run + 1 : 1; prev = w.start; best = Math.max(best, run); }
    else { run = 0; prev = null; }
  }
  return best;
}

/**
 * Where a challenge is in its life.
 *
 * @param ch
 * @param today  ISO date.
 */
export function statusOf(ch: Lifespan, today: string): ChallengeStatus {
  if (ch.status === 'cancelled') return 'cancelled';
  if (today > ch.endDate) return 'ended';
  return today >= ch.startDate ? 'active' : 'upcoming';
}

/**
 * How many live challenges a user is part of (joined, and neither ended nor cancelled).
 *
 * @param list
 * @param uid
 * @param today  ISO date.
 */
export function activeCountFor(list: Array<Lifespan & { participants: Array<{ uid: string; status: string }> }>, uid: string, today: string): number {
  return list.filter(ch => ['upcoming', 'active'].includes(statusOf(ch, today))
    && ch.participants.some(p => p.uid === uid && p.status === 'joined')).length;
}

/**
 * The challenge as shown to participants.
 *
 * @param ch  Stored challenge.
 * @param ctx
 * @param ctx.progress  Stored progress by user id.
 * @param ctx.people    Identity of each participant, by user id.
 * @param ctx.isSharing Whether a user currently shares; people who do not are `paused` and not counted.
 * @param ctx.today
 */
export function challengeView(
  ch: Challenge,
  { progress, people, isSharing: sharing, today }: {
    progress: Record<string, Progress>
    people: Record<string, { handle: string; displayName: string }>
    isSharing: (uid: string) => boolean
    today: string
  }
): ChallengeView {
  const cap = (n: number) => Math.min(1, n / ch.target);
  const rows: ParticipantView[] = ch.participants.map(p => {
    const counts = p.status === 'joined' && sharing(p.uid);
    const state = p.status === 'joined' && !counts ? 'paused' : p.status;
    const current = counts ? progressOf(ch.type, progress[p.uid]) : null;
    return { handle: people[p.uid].handle, displayName: people[p.uid].displayName, state, current, pct: current === null ? null : cap(current), position: null };
  });

  const byName = (a: ParticipantView, b: ParticipantView) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  const counting = rows.filter((r): r is ParticipantView & { current: number } => r.current !== null);
  if (ch.mode === 'versus') {
    counting.sort((a, b) => b.current - a.current || byName(a, b));
    counting.forEach(r => { r.position = 1 + counting.filter(o => o.current > r.current).length; });
  } else counting.sort(byName);
  const others = rows.filter(r => r.current === null).sort(byName);

  const head = <M extends ChallengeMode>(mode: M) => ({
    id: ch.id, title: ch.title, type: ch.type, mode, target: ch.target,
    startDate: ch.startDate, endDate: ch.endDate, status: statusOf(ch, today),
    participants: [...counting, ...others]
  });
  if (ch.mode === 'coop') {
    const total = counting.reduce((n, r) => n + r.current, 0);
    return { ...head('coop'), total, pct: cap(total), done: total >= ch.target };
  }
  return head('versus');
}

/**
 * Takes someone out of a challenge for good (they left the app's social side, or ended a friendship
 * with another participant). Ownership passes to someone still in; with nobody left, it is cancelled.
 *
 * @param ch  Mutated.
 * @param uid
 */
export function removeParticipant(ch: Pick<Challenge, 'ownerId' | 'status' | 'participants'>, uid: string): void {
  ch.participants = ch.participants.filter(p => p.uid !== uid);
  if (ch.ownerId !== uid) return;
  const heir = ch.participants.find(p => p.status === 'joined');
  if (heir) ch.ownerId = heir.uid;
  else { ch.status = 'cancelled'; ch.ownerId = null; }   // nobody is left to own it, and no id must linger
}

/** How long a finished or cancelled challenge is kept, in days. */
export const RETENTION_DAYS = 90;

/**
 * Whether a challenge has been over for longer than the retention period and can be forgotten.
 *
 * @param ch
 * @param today  ISO date.
 */
export function isStale(ch: Lifespan, today: string): boolean {
  return addDays(ch.endDate, RETENTION_DAYS) <= today;
}
