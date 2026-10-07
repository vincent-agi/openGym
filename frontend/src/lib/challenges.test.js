import { describe, it, expect } from 'vitest'
import { TEMPLATES, buildDraft, unitLabel, progressLine, groupChallenges, addDaysIso } from './challenges.js'

describe('addDaysIso', () => {
  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-10-07', 27)).toBe('2026-11-03')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('templates', () => {
  it('start today and last the template length, end date included', () => {
    const d = buildDraft(TEMPLATES[0], '2026-10-07')
    expect(d.startDate).toBe('2026-10-07')
    expect(d.endDate).toBe('2026-11-03')            // 28 days
  })
  it('stay inside what the server accepts', () => {
    for (const tpl of TEMPLATES) {
      const d = buildDraft(tpl, '2026-10-07')
      const days = (Date.parse(d.endDate) - Date.parse(d.startDate)) / 86400000 + 1
      expect(days, tpl.key).toBeGreaterThanOrEqual(7)
      expect(days, tpl.key).toBeLessThanOrEqual(90)
      expect(['sessions', 'activeDays', 'streak', 'consistency']).toContain(d.type)
      expect(['versus', 'coop']).toContain(d.mode)
      expect(Number.isInteger(d.target) && d.target > 0).toBe(true)
    }
  })
  it('includes a co-op template, since not everything has to be a duel', () => {
    expect(TEMPLATES.some(tpl => tpl.mode === 'coop')).toBe(true)
  })
  it('does not share state between drafts', () => {
    const a = buildDraft(TEMPLATES[0], '2026-10-07'); a.title = 'changed'
    expect(buildDraft(TEMPLATES[0], '2026-10-07').title).not.toBe('changed')
  })
})

describe('unitLabel', () => {
  it('names what each type counts', () => {
    expect(unitLabel('sessions')).toBe('sessions')
    expect(unitLabel('activeDays')).toBe('active days')
    expect(unitLabel('streak')).toBe('weeks in a row')
    expect(unitLabel('consistency')).toBe('weeks on plan')
  })
})

describe('progressLine', () => {
  const versus = { mode: 'versus', target: 12, type: 'sessions', participants: [{ handle: 'me', current: 5 }, { handle: 'ana', current: 3 }] }
  it('shows your own count against the target in versus', () => {
    expect(progressLine(versus, 'me')).toEqual({ current: 5, target: 12, pct: 5 / 12, unit: 'sessions' })
  })
  it('shows the crew total in co-op', () => {
    const coop = { mode: 'coop', target: 30, type: 'sessions', total: 18, pct: 0.6, participants: [] }
    expect(progressLine(coop, 'me')).toEqual({ current: 18, target: 30, pct: 0.6, unit: 'sessions' })
  })
  it('is zero for someone who has no count yet', () => {
    expect(progressLine({ ...versus, participants: [{ handle: 'me', current: null }] }, 'me').current).toBe(0)
  })
  it('caps the bar at 100%', () => {
    expect(progressLine({ ...versus, target: 3 }, 'me').pct).toBe(1)
  })
})

describe('groupChallenges', () => {
  const mk = (id, status, state) => ({ id, status, participants: [{ handle: 'me', state }] })
  const list = [mk('a', 'active', 'joined'), mk('b', 'upcoming', 'joined'), mk('c', 'active', 'invited'), mk('d', 'ended', 'joined'), mk('e', 'cancelled', 'invited'), mk('f', 'active', 'paused')]
  it('splits into invitations, running and past', () => {
    const g = groupChallenges(list, 'me')
    expect(g.invited.map(c => c.id)).toEqual(['c'])
    expect(g.running.map(c => c.id)).toEqual(['a', 'b', 'f'])
    expect(g.past.map(c => c.id)).toEqual(['d', 'e'])
  })
})
