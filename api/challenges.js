/**
 * Friendly challenges: a shared goal over a few weeks, either **versus** (everyone chases the
 * same target and the list is ranked) or **co-op** (everyone's progress adds up to one target).
 *
 * Like the rest of the social module, the rules are pure functions over plain data so they can be
 * unit tested; {@link createChallengeService} adapts them to storage and HTTP. Progress is always
 * derived on the server from a user's own saved state, never accepted from a client.
 */
import { addDays, mondayOf, isoInZone, isSession, plannedRoutine } from './summary.js';
import { isSharing, normalizeHandle } from './social.js';

import crypto from 'node:crypto';

/** Hard limits on what can be created. */
export const LIMITS = Object.freeze({
  titleMax: 40, minDays: 7, maxDays: 90, minParticipants: 2, maxParticipants: 12, maxActivePerUser: 5, maxTarget: 365
});

/** What a challenge counts. */
export const TYPES = Object.freeze(['sessions', 'activeDays', 'streak', 'consistency']);

/** `versus`: ranked. `coop`: one shared bar. */
export const MODES = Object.freeze(['versus', 'coop']);

const FIELDS = ['title', 'type', 'mode', 'target', 'startDate', 'endDate', 'invite'];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = s => typeof s === 'string' && ISO_DAY.test(s) && addDays(s, 0) === s;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

/**
 * @typedef {object} ChallengeInput
 * @property {string} title
 * @property {'sessions'|'activeDays'|'streak'|'consistency'} type
 * @property {'versus'|'coop'} mode
 * @property {number} target     Units to reach: sessions, days, weeks in a row, or weeks on plan.
 * @property {string} startDate  ISO date, today or later.
 * @property {string} endDate    ISO date, inclusive.
 * @property {string[]} invite   Handles of friends to invite.
 */

/**
 * Validates the body of `POST /api/social/challenges`.
 *
 * @param {unknown} input
 * @param {{today: string}} ctx  Today's date, ISO, in the caller's frame of reference.
 * @returns {{ok: true, value: ChallengeInput} | {ok: false, error: string}}
 */
export function validateChallengeInput(input, { today }) {
  const bad = error => ({ ok: false, error });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('challenge required');
  const unknown = Object.keys(input).find(k => !FIELDS.includes(k));
  if (unknown) return bad(`unknown field: ${unknown}`);

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || [...title].length > LIMITS.titleMax) return bad(`title must be 1-${LIMITS.titleMax} characters`);
  if (!TYPES.includes(input.type)) return bad('unknown challenge type');
  if (!MODES.includes(input.mode)) return bad('unknown challenge mode');
  if (!Number.isInteger(input.target) || input.target < 1 || input.target > LIMITS.maxTarget) return bad(`target must be a whole number from 1 to ${LIMITS.maxTarget}`);
  if (!isValidDate(input.startDate) || !isValidDate(input.endDate)) return bad('dates must look like 2026-10-07');
  if (input.startDate < today) return bad('a challenge cannot start in the past');
  const days = daysBetween(input.startDate, input.endDate) + 1;
  if (days < LIMITS.minDays || days > LIMITS.maxDays) return bad(`a challenge lasts ${LIMITS.minDays} to ${LIMITS.maxDays} days`);

  const invite = [...new Set((Array.isArray(input.invite) ? input.invite : []).map(normalizeHandle).filter(Boolean))];
  if (invite.length < LIMITS.minParticipants - 1) return bad('invite at least one friend');
  if (invite.length > LIMITS.maxParticipants - 1) return bad(`at most ${LIMITS.maxParticipants} people can take part`);

  return { ok: true, value: { title, type: input.type, mode: input.mode, target: input.target, startDate: input.startDate, endDate: input.endDate, invite } };
}

/**
 * @typedef {object} Progress
 * @property {number} sessions
 * @property {string[]} days  Distinct session dates, ascending.
 * @property {Array<{start: string, sessions: number, planned: number, full: boolean}>} weeks
 *   Every Monday-based week touching the window. `full` means the whole week is inside it.
 */

/**
 * Reads one person's progress inside a window from their saved state.
 *
 * @param {object} state  The user's synced state; never modified.
 * @param {{from: string, to: string, today: string, gaps: Array<{from: string, to: string}>}} win
 *   `from`/`to` bound the challenge for this person (late joiners start later); `gaps` are
 *   periods when sharing was off, which never count.
 * @returns {Progress}
 */
export function collectProgress(state, { from, to, today, gaps }) {
  const end = to < today ? to : today;
  const inGap = d => gaps.some(g => d >= g.from && d <= g.to);
  const counted = (Array.isArray(state?.workouts) ? state.workouts : [])
    .filter(w => isSession(w, today) && w.d >= from && w.d <= end && !inGap(w.d));

  const weeks = [];
  for (let start = mondayOf(from); start <= end; start = addDays(start, 7)) {
    const last = addDays(start, 6);
    let planned = 0;
    for (let i = 0; i < 7; i++) if (plannedRoutine(state || {}, addDays(start, i))) planned++;
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
 * @param {'sessions'|'activeDays'|'streak'|'consistency'} type
 * @param {Progress | undefined} data
 * @returns {number}
 */
export function progressOf(type, data) {
  if (!data) return 0;
  if (type === 'sessions') return data.sessions;
  if (type === 'activeDays') return data.days.length;
  if (type === 'consistency') return data.weeks.filter(w => w.full && w.planned > 0 && w.sessions >= w.planned).length;
  let best = 0, run = 0, prev = null;       // streak: longest run of consecutive weeks with a session
  for (const w of data.weeks) {
    if (w.sessions > 0) { run = prev && addDays(prev, 7) === w.start ? run + 1 : 1; prev = w.start; best = Math.max(best, run); }
    else { run = 0; prev = null; }
  }
  return best;
}

/**
 * Where a challenge is in its life.
 *
 * @param {{startDate: string, endDate: string, status?: string}} ch
 * @param {string} today  ISO date.
 * @returns {'upcoming'|'active'|'ended'|'cancelled'}
 */
export function statusOf(ch, today) {
  if (ch.status === 'cancelled') return 'cancelled';
  if (today > ch.endDate) return 'ended';
  return today >= ch.startDate ? 'active' : 'upcoming';
}

/**
 * How many live challenges a user is part of (joined, and neither ended nor cancelled).
 *
 * @param {Array<{startDate: string, endDate: string, status?: string, participants: Array<{uid: string, status: string}>}>} list
 * @param {string} uid
 * @param {string} today
 * @returns {number}
 */
export function activeCountFor(list, uid, today) {
  return list.filter(ch => ['upcoming', 'active'].includes(statusOf(ch, today))
    && ch.participants.some(p => p.uid === uid && p.status === 'joined')).length;
}

/**
 * @typedef {object} ParticipantView
 * @property {string} handle
 * @property {string} displayName
 * @property {'joined'|'paused'|'invited'|'left'} state  `paused`: stopped sharing; not counted until they resume.
 * @property {number | null} current  Progress, for people who count.
 * @property {number | null} pct      `current / target`, capped at 1.
 * @property {number | null} position Versus only; ties share a position.
 */

/**
 * The challenge as shown to participants.
 *
 * @param {object} ch  Stored challenge.
 * @param {object} ctx
 * @param {Record<string, Progress>} ctx.progress  Stored progress by user id.
 * @param {Record<string, {handle: string, displayName: string}>} ctx.people  Identity of each participant, by user id.
 * @param {(uid: string) => boolean} ctx.isSharing
 * @param {string} ctx.today
 * @returns {object}
 */
export function challengeView(ch, { progress, people, isSharing: sharing, today }) {
  const cap = n => Math.min(1, n / ch.target);
  const rows = ch.participants.map(p => {
    const counts = p.status === 'joined' && sharing(p.uid);
    const state = p.status === 'joined' && !counts ? 'paused' : p.status;
    const current = counts ? progressOf(ch.type, progress[p.uid]) : null;
    return { handle: people[p.uid].handle, displayName: people[p.uid].displayName, state, current, pct: current === null ? null : cap(current), position: null };
  });

  const byName = (a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
  const counting = rows.filter(r => r.current !== null);
  if (ch.mode === 'versus') {
    counting.sort((a, b) => b.current - a.current || byName(a, b));
    counting.forEach(r => { r.position = 1 + counting.filter(o => o.current > r.current).length; });
  } else counting.sort(byName);
  const others = rows.filter(r => r.current === null).sort(byName);

  const view = {
    id: ch.id, title: ch.title, type: ch.type, mode: ch.mode, target: ch.target,
    startDate: ch.startDate, endDate: ch.endDate, status: statusOf(ch, today),
    participants: [...counting, ...others]
  };
  if (ch.mode === 'coop') {
    view.total = counting.reduce((n, r) => n + r.current, 0);
    view.pct = cap(view.total);
    view.done = view.total >= ch.target;
  }
  return view;
}
