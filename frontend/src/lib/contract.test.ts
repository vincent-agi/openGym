import { describe, it, expect, expectTypeOf } from 'vitest'
import {
  BADGES, CHALLENGE_LIMITS, CHALLENGE_MODES, CHALLENGE_TYPES, CHEER_EMOJI, DISPLAY_NAME_MAX, HANDLE_RE, MAX_BREAK_DAYS,
  NOTIFY_KINDS, SHARE_KEYS, SUMMARY_KEYS
} from '../../../shared/constants.ts'
import type {
  BadgeId, ChallengeView, CheerEmoji, CoopChallenge, CrewRow, FeedEvent, NotifyKind, NotifyPrefs, ParticipantState, SharePrefs,
  SharedSummary, SocialSettings, SocialSettingsUpdate, Summary, SummaryKey, VersusChallenge
} from '../../../shared/index.ts'

// The compile-time half of these tests is checked by `npm run typecheck`; the runtime half proves the
// constants and the types describe the same thing. Together they are the contract of the HTTP API.

describe('shared contract: types follow the constants', () => {
  it('a summary has exactly the whitelisted keys', () => {
    expectTypeOf<keyof Summary>().toEqualTypeOf<SummaryKey>()
    const sample = {
      weekSessions: 1, weekPlanned: 3, weekConsistency: 0.33, monthSessions: 4, streakWeeks: 2,
      activeDays: ['2026-10-07'], lastActiveDate: '2026-10-07', prCount: 0, weeklyTrend: null
    } satisfies Summary
    expect(Object.keys(sample).sort()).toEqual([...SUMMARY_KEYS].sort())
  })

  it('what friends receive is a subset of the summary, never more', () => {
    expectTypeOf<SharedSummary>().toEqualTypeOf<Partial<Summary>>()
    expectTypeOf<keyof NonNullable<CrewRow['summary']>>().toEqualTypeOf<SummaryKey>()
  })

  it('share switches, notification kinds and badges come from the constants', () => {
    expectTypeOf<keyof SharePrefs>().toEqualTypeOf<(typeof SHARE_KEYS)[number]>()
    expectTypeOf<Exclude<keyof NotifyPrefs, 'quiet'>>().toEqualTypeOf<NotifyKind>()
    expectTypeOf<NotifyKind>().toEqualTypeOf<(typeof NOTIFY_KINDS)[number]>()
    expectTypeOf<SocialSettings['showBadges'][number]>().toEqualTypeOf<BadgeId>()
    expectTypeOf<BadgeId>().toEqualTypeOf<(typeof BADGES)[number]>()
    expect(BADGES).toHaveLength(6)
  })

  it('cheers are a closed set', () => {
    expectTypeOf<CheerEmoji>().toEqualTypeOf<(typeof CHEER_EMOJI)[number]>()
    expectTypeOf<FeedEvent['myCheer']>().toEqualTypeOf<CheerEmoji | null>()
    expect([...CHEER_EMOJI]).toEqual(['👏', '🔥', '💪', '🎉', '❤️'])
  })

  it('a challenge is a versus one or a co-op one, and only co-op carries a total', () => {
    expectTypeOf<ChallengeView['mode']>().toEqualTypeOf<(typeof CHALLENGE_MODES)[number]>()
    expectTypeOf<ChallengeView>().toEqualTypeOf<VersusChallenge | CoopChallenge>()
    expectTypeOf<CoopChallenge>().toHaveProperty('total')
    expectTypeOf<VersusChallenge>().not.toHaveProperty('total')
    expectTypeOf<ChallengeView['type']>().toEqualTypeOf<(typeof CHALLENGE_TYPES)[number]>()
    expectTypeOf<ParticipantState>().toEqualTypeOf<'joined' | 'paused' | 'invited' | 'left'>()
  })

  it('an update cannot set what only the server writes', () => {
    expectTypeOf<SocialSettingsUpdate>().not.toHaveProperty('earned')
    expectTypeOf<SocialSettings>().toHaveProperty('earned')
    const update = { share: { prs: true }, notify: { quiet: { to: '07:30' } } } satisfies SocialSettingsUpdate
    expect(update.share.prs).toBe(true)
  })

  it('limits agree with the documentation', () => {
    expect(CHALLENGE_LIMITS).toMatchObject({ minDays: 7, maxDays: 90, maxActivePerUser: 5 })
    expect(MAX_BREAK_DAYS).toBe(14)
    expect(HANDLE_RE.test('lea_92')).toBe(true)
    expect(DISPLAY_NAME_MAX).toBe(30)
  })
})
