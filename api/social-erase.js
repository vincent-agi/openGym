/**
 * Erasing a user's social footprint: everything the friends module stored about them, for the
 * "leave" action. Their account and their own training data are not touched.
 *
 * Challenge participation is handled separately (it needs ownership handover); this file removes
 * the rest, and resets the user's settings to the private defaults.
 */
import { defaultSocial } from './social.js';

/**
 * Deletes every social record that mentions a user.
 *
 * @param {object} db   Identity store, mutated in place.
 * @param {string} uid
 * @returns {void}
 */
export function eraseSocialFootprint(db, uid) {
  const ownEvents = new Set(db.socialEvents.filter(e => e.uid === uid).map(e => e.id));

  db.friendships = db.friendships.filter(f => f.a !== uid && f.b !== uid);
  db.friendCodes = db.friendCodes.filter(c => c.uid !== uid);
  delete db.socialSummaries[uid];
  db.socialEvents = db.socialEvents.filter(e => e.uid !== uid);
  db.socialCheers = db.socialCheers.filter(c => c.from !== uid && !ownEvents.has(c.eventId));
  db.cheerMutes = db.cheerMutes.filter(m => m.uid !== uid && m.mutedUid !== uid);
  db.socialOutbox = db.socialOutbox.filter(i => i.uid !== uid);
  db.socialPushLog = db.socialPushLog.filter(l => l.uid !== uid);
  for (const perUser of Object.values(db.challengeProgress)) delete perUser[uid];

  const user = db.users.find(u => u.id === uid);
  if (user) user.social = defaultSocial();
}
