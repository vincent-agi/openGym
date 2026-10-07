import { describe, it, expect } from 'vitest'
import { PERIODS, METRICS, metricsFor, rankCrew, crewHighlights } from './crew.js'

const row = (handle, summary, extra = {}) => ({ handle, displayName: handle[0].toUpperCase() + handle.slice(1), hideRank: false, stale: false, summary, ...extra })
const S = (o = {}) => ({ weekSessions: 0, monthSessions: 0, streakWeeks: 0, weekPlanned: 3, weekConsistency: 0, ...o })
const names = rows => rows.map(r => r.handle)

describe('metrics', () => {
  it('offers consistency only for the week, since a monthly figure is not shared', () => {
    expect(metricsFor('week')).toEqual(['consistency', 'sessions', 'streak'])
    expect(metricsFor('month')).toEqual(['sessions', 'streak'])
    expect(PERIODS).toEqual(['week', 'month'])
    expect(METRICS).toEqual(['consistency', 'sessions', 'streak'])
  })
})

describe('rankCrew — ordering and positions', () => {
  const me = row('me', S({ weekSessions: 2, weekConsistency: 0.67 }))
  const friends = [
    row('ana', S({ weekSessions: 3, weekConsistency: 1 })),
    row('bob', S({ weekSessions: 1, weekConsistency: 0.33 }))
  ]

  it('sorts by the chosen metric, best first, and numbers the positions', () => {
    const r = rankCrew(me, friends, { metric: 'consistency', period: 'week' })
    expect(names(r)).toEqual(['ana', 'me', 'bob'])
    expect(r.map(x => x.position)).toEqual([1, 2, 3])
  })

  it('flags the caller row', () => {
    const r = rankCrew(me, friends, { metric: 'sessions', period: 'week' })
    expect(r.find(x => x.isMe).handle).toBe('me')
    expect(r.filter(x => x.isMe)).toHaveLength(1)
  })

  it('switches value with the period for sessions', () => {
    const m = row('me', S({ weekSessions: 1, monthSessions: 9 }))
    const f = [row('ana', S({ weekSessions: 3, monthSessions: 4 }))]
    expect(names(rankCrew(m, f, { metric: 'sessions', period: 'week' }))).toEqual(['ana', 'me'])
    expect(names(rankCrew(m, f, { metric: 'sessions', period: 'month' }))).toEqual(['me', 'ana'])
  })

  it('shares a position on a tie, orders ties alphabetically, and skips the next number', () => {
    const f = [row('zoe', S({ weekSessions: 2 })), row('ana', S({ weekSessions: 2 })), row('bob', S({ weekSessions: 1 }))]
    const r = rankCrew(row('me', S({ weekSessions: 3 })), f, { metric: 'sessions', period: 'week' })
    expect(names(r)).toEqual(['me', 'ana', 'zoe', 'bob'])
    expect(r.map(x => x.position)).toEqual([1, 2, 2, 4])
  })

  it('never lets anything but the chosen metric break a tie', () => {
    const a = row('ana', S({ weekSessions: 2, monthSessions: 20, streakWeeks: 9 }))
    const b = row('bob', S({ weekSessions: 2, monthSessions: 2, streakWeeks: 0 }))
    expect(names(rankCrew(row('me', S()), [b, a], { metric: 'sessions', period: 'week' }))).toEqual(['ana', 'bob', 'me'])
  })
})

describe('rankCrew — neutral handling of people without a number', () => {
  const run = friends => rankCrew(row('me', S({ weekSessions: 1 })), friends, { metric: 'sessions', period: 'week' })
  const byHandle = (r, h) => r.find(x => x.handle === h)

  it('puts people with no session yet after the ranked ones, without a position', () => {
    const r = run([row('ana', S({ weekSessions: 0 }))])
    expect(names(r)).toEqual(['me', 'ana'])
    expect(byHandle(r, 'ana')).toMatchObject({ status: 'idle', position: null })
  })

  it('marks stale data, missing summaries and unshared metrics as such, never as last place', () => {
    const r = run([
      row('old', S({ weekSessions: 9 }), { stale: true }),
      row('new', null),
      row('priv', { streakWeeks: 3 })
    ])
    expect(byHandle(r, 'old')).toMatchObject({ status: 'stale', position: null })
    expect(byHandle(r, 'new')).toMatchObject({ status: 'pending', position: null })
    expect(byHandle(r, 'priv')).toMatchObject({ status: 'private', position: null })
    expect(names(r)[0]).toBe('me')
  })

  it('treats "nothing planned this week" as its own state for consistency', () => {
    const r = rankCrew(row('me', S({ weekConsistency: 1 })), [row('rest', S({ weekPlanned: 0, weekConsistency: null }))], { metric: 'consistency', period: 'week' })
    expect(byHandle(r, 'rest')).toMatchObject({ status: 'noplan', position: null })
  })

  it('lists unranked people alphabetically', () => {
    const r = run([row('zed', S()), row('amy', null), row('kim', S())])
    expect(names(r)).toEqual(['me', 'amy', 'kim', 'zed'])
  })
})

describe('rankCrew — opting out of rankings', () => {
  const friends = [row('ana', S({ weekSessions: 5 }), { hideRank: true }), row('bob', S({ weekSessions: 2 }))]

  it('lists friends who hid their rank without a position, after the ranked ones, keeping their number', () => {
    const r = rankCrew(row('me', S({ weekSessions: 1 })), friends, { metric: 'sessions', period: 'week' })
    expect(names(r)).toEqual(['bob', 'me', 'ana'])
    expect(r.map(x => x.position)).toEqual([1, 2, null])
    expect(r[2]).toMatchObject({ status: 'hidden', value: 5 })
  })

  it('shows no positions and no ordering by score to a viewer who hid their own rank', () => {
    const r = rankCrew(row('me', S({ weekSessions: 1 })), friends, { metric: 'sessions', period: 'week', viewerHidesRank: true })
    expect(r.every(x => x.position === null)).toBe(true)
    expect(names(r)).toEqual(['ana', 'bob', 'me'])
  })
})

describe('crewHighlights — the compact Home card', () => {
  const rows = rankCrew(row('me', S({ weekSessions: 1 })), [
    row('a', S({ weekSessions: 5 })), row('b', S({ weekSessions: 4 })), row('c', S({ weekSessions: 3 })), row('d', S({ weekSessions: 2 }))
  ], { metric: 'sessions', period: 'week' })

  it('keeps the top three and the caller position', () => {
    const h = crewHighlights(rows)
    expect(names(h.top)).toEqual(['a', 'b', 'c'])
    expect(h.mine).toMatchObject({ handle: 'me', position: 5 })
  })

  it('has no position for a caller who opted out', () => {
    const h = crewHighlights(rankCrew(row('me', S({ weekSessions: 1 })), [row('a', S({ weekSessions: 5 }))], { metric: 'sessions', period: 'week', viewerHidesRank: true }))
    expect(h.top).toEqual([])
    expect(h.mine.position).toBeNull()
  })
})
