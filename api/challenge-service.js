/**
 * Storage and HTTP for friendly challenges. The rules live in `challenges.js`; this file only
 * connects them to the identity store, the friend graph and the routes.
 *
 * Progress is recomputed from the participant's own saved state whenever it is saved
 * ({@link ChallengeService.recordProgress}); a client can never submit it.
 */
import crypto from 'node:crypto';
import { addDays, isoInZone } from './summary.js';
import { isSharing, requireSharing } from './social.js';
import { relationsOf } from './friends.js';
import {
  LIMITS, validateChallengeInput, collectProgress, progressOf, statusOf, activeCountFor, challengeView
} from './challenges.js';

/**
 * @typedef {object} ChallengeService
 * @property {(user: object, state: object) => void} recordProgress
 *   Updates the stored progress of every live challenge the user is in, from their saved state.
 * @property {(user: object, wasSharing: boolean) => void} onSharingChange
 *   Pauses or resumes the user's participations when they turn sharing off or back on.
 * @property {() => Array<{title: string, uids: string[], coopDone: boolean, endDate: string}>} collectEnded
 *   Challenges that finished since the last call, once each: whom to tell, and whether a co-op target was reached.
 * @property {Record<string, Function>} routes
 */

/**
 * @param {object} ctx
 * @param {{users: object[], friendships: object[], challenges: object[], challengeProgress: Record<string, Record<string, object>>}} ctx.db
 * @param {() => void} ctx.saveDb
 * @param {(req: import('node:http').IncomingMessage) => (object | null)} ctx.readSession
 * @param {(res: import('node:http').ServerResponse, code: number, body: object) => void} ctx.json
 * @param {(req: import('node:http').IncomingMessage) => Promise<any>} ctx.readBody
 * @param {(uid: string) => (object | null)} ctx.readState  Reads a user's saved state, null before the first sync.
 * @param {(uid: string, kind: string, data: object) => Promise<boolean>} [ctx.notify]  Push notifier; the default does nothing.
 * @param {() => number} [ctx.now]
 * @returns {ChallengeService}
 */
export function createChallengeService({ db, saveDb, readSession, json, readBody, readState, notify = async () => false, now = Date.now }) {
  const utcToday = () => isoInZone(now(), 'UTC');
  const userById = id => db.users.find(u => u.id === id);
  const userByHandle = handle => db.users.find(u => u.social?.handle === handle);
  const participantOf = (ch, uid) => ch.participants.find(p => p.uid === uid);
  const liveStatus = ch => ['upcoming', 'active'].includes(statusOf(ch, utcToday()));

  /** The challenge as shown to participants; an ended one is frozen the first time it is read. */
  const viewOf = ch => {
    if (ch.final) return ch.final;
    const today = utcToday();
    const members = ch.participants.filter(p => userById(p.uid));
    const people = Object.fromEntries(members.map(p => [p.uid, userById(p.uid).social || { handle: '', displayName: '' }]));
    const view = challengeView({ ...ch, participants: members }, {
      progress: db.challengeProgress[ch.id] || {}, people, isSharing: uid => isSharing(userById(uid)), today
    });
    if (view.status === 'ended') { ch.final = view; saveDb(); }
    return view;
  };

  /** Recomputes one participant's progress. @returns {boolean} whether anything changed */
  const record = (ch, p, state, today) => {
    const from = p.joinedDate && p.joinedDate > ch.startDate ? p.joinedDate : ch.startDate;
    const data = collectProgress(state, { from, to: ch.endDate, today, gaps: p.gaps || [] });
    const store = (db.challengeProgress[ch.id] ||= {});
    if (JSON.stringify(store[p.uid]) === JSON.stringify(data)) return false;
    store[p.uid] = data;
    return true;
  };

  /** Tells people when a challenge passes half-way (co-op) or when someone reaches the target. Each only once. */
  const checkMilestones = ch => {
    const progress = db.challengeProgress[ch.id] || {};
    const joined = ch.participants.filter(p => p.status === 'joined' && isSharing(userById(p.uid)));
    let changed = false;
    if (ch.mode === 'coop') {
      const total = joined.reduce((n, p) => n + progressOf(ch.type, progress[p.uid]), 0);
      const stage = total >= ch.target ? 'target' : total >= ch.target / 2 ? 'half' : null;
      const marks = (ch.milestones ||= {});
      if (stage && !marks[stage]) {
        marks.half = true; if (stage === 'target') marks.target = true;
        joined.forEach(p => notify(p.uid, 'challengeMilestone', { title: ch.title, stage }));
        changed = true;
      }
    } else {
      for (const p of joined) {
        if (!p.reached && progressOf(ch.type, progress[p.uid]) >= ch.target) {
          p.reached = true; changed = true;
          notify(p.uid, 'challengeMilestone', { title: ch.title, stage: 'target' });
        }
      }
    }
    return changed;
  };

  const recordProgress = (user, state) => {
    if (!isSharing(user)) return;
    try {
      const today = isoInZone(now(), state?.reminder?.tz || 'UTC');
      let changed = false;
      for (const ch of db.challenges) {
        const p = participantOf(ch, user.id);
        if (p?.status === 'joined' && statusOf(ch, today) === 'active') {
          changed = record(ch, p, state, today) || changed;
          changed = checkMilestones(ch) || changed;
        }
      }
      if (changed) saveDb();
    } catch (e) { console.error('challenge progress failed for', user.id, e); }
  };

  const onSharingChange = (user, wasSharing) => {
    const today = utcToday();
    const nowSharing = isSharing(user);
    let changed = false;
    for (const ch of db.challenges) {
      const p = participantOf(ch, user.id);
      if (p?.status !== 'joined') continue;
      if (wasSharing && !nowSharing && !p.pausedFrom) { p.pausedFrom = today; changed = true; }
      if (!wasSharing && nowSharing && p.pausedFrom) {
        if (p.pausedFrom < today) (p.gaps ||= []).push({ from: p.pausedFrom, to: addDays(today, -1) });
        delete p.pausedFrom; changed = true;
      }
    }
    if (changed) saveDb();
    if (nowSharing && !wasSharing) { const st = readState(user.id); if (st) recordProgress(user, st); }
  };

  /** Finds a challenge the caller takes part in; answers 404 otherwise, whatever the reason. */
  const mine = (res, user, id) => {
    const ch = db.challenges.find(c => c.id === id);
    if (!ch || !participantOf(ch, user.id)) { json(res, 404, { error: 'not found' }); return null; }
    return ch;
  };

  const routes = {
    'GET /api/social/challenges': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const list = db.challenges.filter(c => ['joined', 'invited'].includes(participantOf(c, user.id)?.status));
      json(res, 200, { challenges: list.map(viewOf) });
    },

    'GET /api/social/challenge': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const ch = mine(res, user, new URL(req.url, 'http://x').searchParams.get('id'));
      if (ch) json(res, 200, { challenge: viewOf(ch) });
    },

    'POST /api/social/challenges': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const today = utcToday();
      const checked = validateChallengeInput(await readBody(req), { today });
      if (!checked.ok) return json(res, 400, { error: checked.error });

      const friends = new Set(relationsOf(db.friendships, user.id).friends.map(f => f.uid));
      const invitees = checked.value.invite.map(userByHandle);
      if (invitees.some(u => !u || !friends.has(u.id) || !isSharing(u))) {
        return json(res, 400, { error: 'you can only invite friends who are sharing' });
      }
      if (activeCountFor(db.challenges, user.id, today) >= LIMITS.maxActivePerUser) {
        return json(res, 409, { error: `you can be in at most ${LIMITS.maxActivePerUser} challenges at once` });
      }

      const { invite, ...fields } = checked.value;
      const ch = {
        id: crypto.randomBytes(8).toString('base64url'), ownerId: user.id, ...fields, status: 'open', createdAt: now(),
        participants: [
          { uid: user.id, status: 'joined', joinedAt: now(), joinedDate: today, gaps: [] },
          ...invitees.map(u => ({ uid: u.id, status: 'invited' }))
        ]
      };
      db.challenges.push(ch);
      saveDb();
      invitees.forEach(u => notify(u.id, 'challengeInvite', { name: user.social.displayName, title: ch.title }));
      json(res, 200, { challenge: viewOf(ch) });
    },

    'POST /api/social/challenges/join': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const ch = mine(res, user, (await readBody(req)).id);
      if (!ch) return;
      const p = participantOf(ch, user.id);
      if (!['invited', 'left'].includes(p.status) || !liveStatus(ch)) return json(res, 404, { error: 'not found' });
      if (activeCountFor(db.challenges, user.id, utcToday()) >= LIMITS.maxActivePerUser) {
        return json(res, 409, { error: `you can be in at most ${LIMITS.maxActivePerUser} challenges at once` });
      }
      Object.assign(p, { status: 'joined', joinedAt: now(), joinedDate: utcToday(), gaps: [] });
      delete p.pausedFrom;
      saveDb();
      const state = readState(user.id);
      if (state) recordProgress(user, state);
      json(res, 200, { challenge: viewOf(ch) });
    },

    'POST /api/social/challenges/leave': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const ch = mine(res, user, (await readBody(req)).id);
      if (!ch) return;
      const p = participantOf(ch, user.id);
      if (!['invited', 'joined'].includes(p.status)) return json(res, 404, { error: 'not found' });
      p.status = 'left';
      if (ch.ownerId === user.id) {
        const heir = ch.participants.find(o => o.status === 'joined');
        if (heir) ch.ownerId = heir.uid; else ch.status = 'cancelled';
      }
      saveDb();
      json(res, 200, { ok: true });
    },

    'POST /api/social/challenges/cancel': async (req, res) => {
      const user = requireSharing(readSession, json, req, res);
      if (!user) return;
      const ch = mine(res, user, (await readBody(req)).id);
      if (!ch || ch.ownerId !== user.id) { if (ch) json(res, 404, { error: 'not found' }); return; }
      ch.status = 'cancelled';
      saveDb();
      json(res, 200, { ok: true });
    }
  };

  const collectEnded = () => {
    const today = utcToday();
    const finished = db.challenges.filter(ch => ch.status !== 'cancelled' && !ch.endedNotified && statusOf(ch, today) === 'ended');
    finished.forEach(ch => { ch.endedNotified = true; });
    if (finished.length) saveDb();
    return finished.map(ch => {
      const uids = ch.participants.filter(p => p.status === 'joined').map(p => p.uid);
      const total = uids.reduce((n, uid) => n + progressOf(ch.type, db.challengeProgress[ch.id]?.[uid]), 0);
      return { title: ch.title, uids, coopDone: ch.mode === 'coop' && total >= ch.target, endDate: ch.endDate };
    });
  };

  return { recordProgress, onSharingChange, collectEnded, routes };
}
