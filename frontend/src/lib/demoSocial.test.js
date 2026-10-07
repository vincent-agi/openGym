import { describe, it, expect } from 'vitest'
import { demoSocialApi, DEMO_ME_HANDLE } from './demoSocial.js'
import { SUMMARY_KEYS } from '../../../api/summary.js'
import { BADGES } from '../../../api/badges.js'
import { CHEER_EMOJI } from './cheers.js'
import { rankCrew } from './crew.js'

const NOW = Date.parse('2026-10-07T10:00:00Z')
const get = path => demoSocialApi(path, undefined, NOW)

describe('demo social data', () => {
  it('says the module is on', () => {
    expect(get('/api/config')).toMatchObject({ social_enabled: true })
  })

  it('has a user who shares, with the same settings shape as the real API', () => {
    const { social } = get('/api/social/me')
    expect(social).toMatchObject({ enabled: true, handle: DEMO_ME_HANDLE, hideRank: false })
    expect(Object.keys(social.share).sort()).toEqual(['consistency', 'prs', 'sessions', 'streak'])
    expect(social.notify.quiet).toEqual({ from: '21:00', to: '08:00' })
    for (const b of social.earned) expect(BADGES).toContain(b.id)
  })

  it('has three friends with summaries that follow the real whitelist', () => {
    const { me, friends } = get('/api/social/friends/summary')
    expect(friends).toHaveLength(3)
    for (const row of [me, ...friends]) {
      expect(row.summary).not.toBeNull()
      for (const k of Object.keys(row.summary)) expect(SUMMARY_KEYS).toContain(k)
      expect(row.stale).toBe(false)
    }
  })

  it('makes a believable leaderboard: the viewer is somewhere in the middle, nobody last by name', () => {
    const { me, friends } = get('/api/social/friends/summary')
    const rows = rankCrew(me, friends, { metric: 'consistency', period: 'week' })
    expect(rows).toHaveLength(4)
    expect(rows.every(r => r.position !== null)).toBe(true)
    expect(rows.findIndex(r => r.isMe)).toBeGreaterThan(0)
  })

  it('lists the same friends in the friends list', () => {
    const list = get('/api/social/friends')
    expect(list.friends.map(f => f.handle).sort()).toEqual(get('/api/social/friends/summary').friends.map(f => f.handle).sort())
    expect(list.incoming).toEqual([])
  })

  it('has one active challenge, a co-op one in progress, that the viewer is in', () => {
    const { challenges } = get('/api/social/challenges')
    expect(challenges).toHaveLength(1)
    const c = challenges[0]
    expect(c).toMatchObject({ status: 'active', mode: 'coop' })
    expect(c.pct).toBeGreaterThan(0)
    expect(c.pct).toBeLessThan(1)
    expect(c.participants.some(p => p.handle === DEMO_ME_HANDLE && p.state === 'joined')).toBe(true)
    expect(get('/api/social/challenge?id=' + c.id).challenge.id).toBe(c.id)
  })

  it('has a feed with cheers from the allowed set only', () => {
    const { events, mine } = get('/api/social/feed')
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) for (const ch of e.cheers) expect(CHEER_EMOJI).toContain(ch.emoji)
    for (const ch of mine[0].cheers) expect(CHEER_EMOJI).toContain(ch.emoji)
  })

  it('follows the clock: this week is the week of "now"', () => {
    const { friends } = get('/api/social/friends/summary')
    const lastActive = friends.map(f => f.summary.lastActiveDate).sort().pop()
    expect(lastActive <= '2026-10-07').toBe(true)
    expect(lastActive >= '2026-10-01').toBe(true)
  })

  it('refuses to change anything, with a friendly explanation', () => {
    expect(() => demoSocialApi('/api/social/cheer', { method: 'POST', body: '{}' }, NOW)).toThrow(/demo/i)
    expect(() => demoSocialApi('/api/social/me', { method: 'PUT', body: '{}' }, NOW)).toThrow(/demo/i)
  })

  it('does not answer routes it does not know', () => {
    expect(() => get('/api/social/unknown')).toThrow()
  })
})
