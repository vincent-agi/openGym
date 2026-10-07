/**
 * Wire types of the friends module (`/api/social/*`): what each request carries and each response returns.
 * Types, not validators: the API still validates every payload by hand.
 */
import type {
  BadgeId, ChallengeMode, ChallengeType, CheerEmoji, NotifyKind, ShareKey
} from './constants.ts'

/* ---------------------------------- profile and consent ---------------------------------- */

/** What friends may see, switch by switch. */
export type SharePrefs = Record<ShareKey, boolean>

/** Quiet hours, `HH:MM`, in the user's own time zone. */
export interface QuietHours { from: string; to: string }

/** Which events may send a push notification (all off by default) and the quiet hours. */
export type NotifyPrefs = Record<NotifyKind, boolean> & { quiet: QuietHours }

/** A badge earned, with the day it was first deserved. */
export interface Earned { id: BadgeId; date: string }

/** `GET /api/social/me` and what `PUT` returns. Server-side counters are never part of it. */
export interface SocialSettings {
  enabled: boolean
  handle: string
  displayName: string
  share: SharePrefs
  hideRank: boolean
  notify: NotifyPrefs
  /** Earned badges friends may see; none by default. */
  showBadges: BadgeId[]
  /** Written by the server only: a client that sends it is refused. */
  earned: Earned[]
}
export interface SocialMeResponse { social: SocialSettings }

/** Body of `PUT /api/social/me`: any subset of the editable settings; unknown fields are refused. */
export interface SocialSettingsUpdate {
  enabled?: boolean
  handle?: string
  displayName?: string
  share?: Partial<SharePrefs>
  hideRank?: boolean
  notify?: Partial<Record<NotifyKind, boolean>> & { quiet?: Partial<QuietHours> }
  showBadges?: BadgeId[]
}

/** Body of `POST /api/social/leave`. */
export interface LeaveBody { confirm: true }

/* ---------------------------------------- friends ---------------------------------------- */

export interface FriendCard { handle: string; displayName: string }
export interface Friend extends FriendCard { since: number }
/** `GET /api/social/friends`. People who stopped sharing are left out; blocks against you are never listed. */
export interface FriendsResponse {
  friends: Friend[]
  incoming: FriendCard[]
  outgoing: FriendCard[]
  blocked: Array<{ handle: string }>
}
/** `POST /api/social/friends/code`. */
export interface FriendCodeResponse { code: string; expiresAt: number }
/** `POST /api/social/friends/request`: a code or an exact handle. */
export type FriendRequestBody = { code: string } | { handle: string }
export interface FriendRequestResponse { status: 'pending' | 'accepted'; friend: FriendCard }
/** `POST /api/social/friends/respond`. */
export interface FriendRespondBody { handle: string; action: 'accept' | 'decline' }
/** `remove`, `block` and `unblock`. */
export interface HandleBody { handle: string }

/* ---------------------------------- the shared summary ---------------------------------- */

/** The full summary the server computes. Friends only receive the part the owner shares. */
export interface Summary {
  weekSessions: number
  weekPlanned: number
  /** `weekSessions / weekPlanned`, capped at 1; null when nothing was planned. */
  weekConsistency: number | null
  monthSessions: number
  streakWeeks: number
  /** ISO dates with a session in the last 28 days. */
  activeDays: string[]
  lastActiveDate: string | null
  prCount: number
  /** Sessions a week over the last four completed weeks minus the four before; null with no history. */
  weeklyTrend: number | null
}
/** What a friend receives: only the keys the owner chose to share. */
export type SharedSummary = Partial<Summary>

/** One person of the crew, the caller included. */
export interface CrewRow {
  handle: string
  displayName: string
  hideRank: boolean
  badges: Earned[]
  /** Null before their first sync. */
  summary: SharedSummary | null
  updatedAt: number | null
  stale: boolean
}
/** `GET /api/social/friends/summary`. */
export interface CrewSummaryResponse { me: CrewRow; friends: CrewRow[] }

/* ---------------------------------------- challenges ---------------------------------------- */

export type ChallengeStatus = 'upcoming' | 'active' | 'ended' | 'cancelled'
/** `paused`: the person stopped sharing; they do not count until they resume. */
export type ParticipantState = 'joined' | 'paused' | 'invited' | 'left'

export interface ParticipantView {
  handle: string
  displayName: string
  state: ParticipantState
  current: number | null
  pct: number | null
  /** Versus only; ties share a position. */
  position: number | null
}

interface ChallengeBase {
  id: string
  title: string
  type: ChallengeType
  target: number
  startDate: string
  endDate: string
  status: ChallengeStatus
  participants: ParticipantView[]
}
export type VersusChallenge = ChallengeBase & { mode: 'versus' }
/** A co-op challenge adds its shared total. */
export type CoopChallenge = ChallengeBase & { mode: 'coop'; total: number; pct: number; done: boolean }
export type ChallengeView = VersusChallenge | CoopChallenge

/** Body of `POST /api/social/challenges`. */
export interface CreateChallengeBody {
  title: string
  type: ChallengeType
  mode: ChallengeMode
  target: number
  startDate: string
  endDate: string
  /** Handles of accepted friends who are sharing. */
  invite: string[]
}
export interface ChallengesResponse { challenges: ChallengeView[] }
export interface ChallengeResponse { challenge: ChallengeView }
/** `join`, `leave` and `cancel`. */
export interface ChallengeIdBody { id: string }

/* ------------------------------------ cheers and the feed ------------------------------------ */

export interface CheerCount { emoji: CheerEmoji; count: number }
/** A friend finished a session. It names nobody's routine, exercise, weight or duration. */
export interface FeedEvent {
  id: string
  handle: string
  displayName: string
  date: string
  createdAt: number
  cheers: CheerCount[]
  myCheer: CheerEmoji | null
}
/** One of your own recent sessions, with the cheers it received. */
export interface OwnSession {
  id: string
  date: string
  createdAt: number
  cheers: CheerCount[]
  from: Array<{ emoji: CheerEmoji; displayName: string }>
}
/** `GET /api/social/feed`. `muted` lists the friends whose cheers you muted (only you can see that). */
export interface FeedResponse { events: FeedEvent[]; mine: OwnSession[]; muted: string[] }
/** `POST /api/social/cheer`: exactly these two fields. */
export interface CheerBody { eventId: string; emoji: CheerEmoji }
export interface RetractCheerBody { eventId: string }
export interface MuteCheerBody { handle: string; muted: boolean }
