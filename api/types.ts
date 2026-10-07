/**
 * The shape of everything the API keeps in `db.json`, and of the plumbing its modules share.
 *
 * Wire types (what crosses HTTP) live in `shared/`; this file is the server's own view: the identity store,
 * the friends module's collections, the open shape of a user's saved state, and the injected services every
 * `create*` function receives. Types only, plus one runtime helper ({@link emptySocialCollections}) so the
 * list of collections is written once. See docs/technical/data-model.md for the prose.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ChallengeMode, ChallengeType, CheerEmoji, NotifyKind } from '../shared/constants.ts'
import type { ChallengeView, SocialSettings, Summary } from '../shared/social.ts'

/* ------------------------------------- identity store ------------------------------------- */

/** What the server stores about a user's friends settings: the public settings plus server-side counters. */
export interface StoredSocial extends SocialSettings {
  /** Cheers sent, behind the Cheerleader badge; never sent to clients. */
  cheersSent?: number
  /** ISO date of the first co-op challenge finished together; server-side. */
  coopCompletedOn?: string
}

export interface User {
  id: string
  name: string
  created?: string
  admin?: boolean
  disabled?: boolean
  /** The invite code used to register. */
  invitedBy?: string
  /** Session version: bumping it signs the account out everywhere. */
  sv?: number
  /** ISO date of the last day-reminder push. */
  lastReminder?: string
  /** Absent until the user first saves their friends settings. */
  social?: StoredSocial
}

/** A WebAuthn credential. */
export interface Cred {
  id: string
  userId: string
  publicKey: string
  counter: number
  transports: string[]
}

/** A Web Push subscription. */
export interface Sub {
  userId: string
  endpoint: string
  keys: { p256dh: string; auth: string }
  created?: string
}

/** An invitation code (instances that require one to register). */
export interface InviteRecord {
  code: string
  note: string
  createdBy: string
  created: string
  usedBy?: string
  usedAt?: string
  revoked?: boolean
}

export interface IdentityStore {
  users: User[]
  creds: Cred[]
  subs: Sub[]
  invites: InviteRecord[]
}

/* ------------------------------------ friends & challenges ------------------------------------ */

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked'

/** One record per pair of users, whatever the direction. `a` is the lower user id. */
export interface Friendship {
  id: string
  a: string
  b: string
  status: FriendshipStatus
  requestedBy: string
  createdAt: number
  /** Epoch ms the friendship was accepted. */
  since?: number
  blockedBy?: string
}

export interface FriendCode {
  code: string
  uid: string
  createdAt: number
  expiresAt: number
  revoked?: boolean
}

/** A user's derived summary, as stored. Friends receive the part the owner shares. */
export interface SummaryRecord { data: Summary; updatedAt: number }

export type StoredChallengeStatus = 'open' | 'cancelled'
export type StoredParticipantStatus = 'joined' | 'invited' | 'left'

export interface Participant {
  uid: string
  status: StoredParticipantStatus
  joinedAt?: number
  /** ISO date the person started counting from. */
  joinedDate?: string
  /** Periods when sharing was off; they never count. */
  gaps?: Array<{ from: string; to: string }>
  /** Set while sharing is off. */
  pausedFrom?: string
  /** A versus participant already told they reached the target. */
  reached?: boolean
}

export interface Challenge {
  id: string
  /** Null when nobody is left to own a cancelled challenge. */
  ownerId: string | null
  title: string
  type: ChallengeType
  mode: ChallengeMode
  target: number
  startDate: string
  endDate: string
  status: StoredChallengeStatus
  createdAt: number
  participants: Participant[]
  /** The frozen view, written the first time a finished challenge is read. */
  final?: ChallengeView
  endedNotified?: boolean
  milestones?: { half?: boolean; target?: boolean }
}

/** One person's derived progress inside a challenge. */
export interface ChallengeProgress {
  sessions: number
  days: string[]
  weeks: Array<{ start: string; sessions: number; planned: number; full: boolean }>
}

export interface SocialEvent {
  id: string
  uid: string
  /** Internal reference used to avoid recording a session twice; never sent to friends. */
  ref: string
  date: string
  kind: 'session'
  createdAt: number
}

export interface SocialCheer { eventId: string; from: string; emoji: CheerEmoji; createdAt: number }
export interface CheerMute { uid: string; mutedUid: string }

/** A push waiting for its time (batching, quiet hours). */
export interface OutboxItem {
  id: string
  uid: string
  kind: NotifyKind
  data: Record<string, unknown>
  createdAt: number
  deliverAt: number
}

export interface PushLogEntry { uid: string; kind: NotifyKind; ts: number; date: string }

export interface SocialCollections {
  friendships: Friendship[]
  friendCodes: FriendCode[]
  /** By user id. Only present while the user is sharing. */
  socialSummaries: Record<string, SummaryRecord>
  challenges: Challenge[]
  /** By challenge id, then user id. */
  challengeProgress: Record<string, Record<string, ChallengeProgress>>
  socialEvents: SocialEvent[]
  socialCheers: SocialCheer[]
  cheerMutes: CheerMute[]
  socialOutbox: OutboxItem[]
  socialPushLog: PushLogEntry[]
}

/** The whole of `db.json`. */
export type Db = IdentityStore & SocialCollections

/** Collection names, in file order. A test compares them to the database the server builds. */
export const IDENTITY_KEYS = ['users', 'creds', 'subs', 'invites'] as const
export const SOCIAL_KEYS = [
  'friendships', 'friendCodes', 'socialSummaries', 'challenges', 'challengeProgress',
  'socialEvents', 'socialCheers', 'cheerMutes', 'socialOutbox', 'socialPushLog'
] as const

// Compile-time guards: the key lists and the interfaces cannot drift apart.
type AssertTrue<T extends true> = T
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export type _IdentityKeysMatch = AssertTrue<Same<(typeof IDENTITY_KEYS)[number], keyof IdentityStore>>
export type _SocialKeysMatch = AssertTrue<Same<(typeof SOCIAL_KEYS)[number], keyof SocialCollections>>

/** New, empty social collections. Always fresh objects: two stores never share state. */
export function emptySocialCollections(): SocialCollections {
  return {
    friendships: [], friendCodes: [], socialSummaries: {}, challenges: [], challengeProgress: {},
    socialEvents: [], socialCheers: [], cheerMutes: [], socialOutbox: [], socialPushLog: []
  }
}

/* ---------------------------------------- saved state ---------------------------------------- */

/**
 * A user's saved app state, as the server sees it: whatever the app sent, stored as is. Only the fields the
 * server reads are named, and each is `unknown` on purpose: the document is untrusted and can be malformed,
 * so every reader narrows before use (see `api/summary.ts`).
 */
export interface StateDoc {
  workouts?: unknown
  routines?: unknown
  week?: unknown
  dayPlan?: unknown
  breaks?: unknown
  reminder?: unknown
  lang?: unknown
  tz?: unknown
  _ts?: unknown
  [other: string]: unknown
}

/* ------------------------------------------ plumbing ------------------------------------------ */

export type Route = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
/** Keyed `"METHOD /api/path"`. */
export type Routes = Record<string, Route>

export type JsonResponder = (res: ServerResponse, code: number, body: unknown, headers?: Record<string, string>) => void

/**
 * The services the server hands to every `create*` function. Each module takes the subset it needs.
 * `readBody` resolves to whatever JSON the client sent (an object, but also `null` or a string): handlers
 * validate before they read it.
 */
export interface Services {
  db: Db
  saveDb: () => void
  readSession: (req: IncomingMessage) => User | null
  json: JsonResponder
  readBody: (req: IncomingMessage) => Promise<unknown>
  readState: (uid: string) => StateDoc | null
  now?: () => number
}

/** Delivers (or queues) a push notification; resolves to whether it was accepted. */
export type Notify = (uid: string, kind: NotifyKind, data: Record<string, unknown>) => Promise<boolean>

/** The actions that are rate limited. */
export type GuardRule = 'friendRequest' | 'friendCode' | 'cheer' | 'challengeCreate'
/** Answers `429` itself and returns false when the action is over its limit. */
export type Guard = (rule: GuardRule, req: IncomingMessage, res: ServerResponse, user: { id: string }) => boolean

/** Optional collaborators of the social services. */
export interface SocialHooks {
  notify?: Notify
  guard?: Guard
  /** Someone sent a cheer for the first time on an event. */
  onNewCheer?: (sender: User) => void
  /** A friendship ended; clean up what the two shared. */
  onSever?: (actor: string, other: string) => void
  /** Settings changed; `wasSharing` is the state before the change. */
  onChange?: (user: User, wasSharing: boolean) => void
}

