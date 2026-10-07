/**
 * Constants the API and the frontend must agree on. They live here, once, so that adding a badge or a
 * cheer is one edit that both sides (and their type checks) see, instead of two edits kept in step by a test.
 *
 * Erasable TypeScript only: this file is run by Node as-is (API) and bundled by Vite (frontend).
 */

/** The only cheers that exist (see `api/feed.ts`). */
export const CHEER_EMOJI = ['👏', '🔥', '💪', '🎉', '❤️'] as const
export type CheerEmoji = (typeof CHEER_EMOJI)[number]

/** Every key a shared activity summary may contain. Adding one is a privacy decision. */
export const SUMMARY_KEYS = [
  'weekSessions', 'weekPlanned', 'weekConsistency', 'monthSessions', 'streakWeeks',
  'activeDays', 'lastActiveDate', 'prCount', 'weeklyTrend'
] as const
export type SummaryKey = (typeof SUMMARY_KEYS)[number]

/** Every badge that exists. Names and descriptions live in the frontend. */
export const BADGES = ['first-week', 'hat-trick', 'four-in-a-row', 'back-on-track', 'team-player', 'cheerleader'] as const
export type BadgeId = (typeof BADGES)[number]

/** Events a user can opt in to be notified about, in display order. */
export const NOTIFY_KINDS = ['friendSession', 'cheerReceived', 'challengeInvite', 'challengeMilestone', 'challengeEnded'] as const
export type NotifyKind = (typeof NOTIFY_KINDS)[number]

/** What a user can choose to share with friends. */
export const SHARE_KEYS = ['sessions', 'streak', 'consistency', 'prs'] as const
export type ShareKey = (typeof SHARE_KEYS)[number]

/** Handles are 3-20 characters of lowercase letters, digits and underscore. */
export const HANDLE_RE = /^[a-z0-9_]{3,20}$/

/** Longest display name, in characters. */
export const DISPLAY_NAME_MAX = 30

/** What a challenge counts. */
export const CHALLENGE_TYPES = ['sessions', 'activeDays', 'streak', 'consistency'] as const
export type ChallengeType = (typeof CHALLENGE_TYPES)[number]

/** `versus`: ranked. `coop`: one shared bar. */
export const CHALLENGE_MODES = ['versus', 'coop'] as const
export type ChallengeMode = (typeof CHALLENGE_MODES)[number]

/** Hard limits on what can be created. */
export const CHALLENGE_LIMITS = {
  titleMax: 40, minDays: 7, maxDays: 90, minParticipants: 2, maxParticipants: 12, maxActivePerUser: 5, maxTarget: 365
} as const

/** Longest planned break, in days. A break never silences the plan for good. */
export const MAX_BREAK_DAYS = 14
