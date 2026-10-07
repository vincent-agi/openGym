import { describe, it, expect } from 'vitest'
import { lastWeekStats, recapVisible, recapLine, buildRecap, weekStartOf } from './recap.js'

// Wednesday 7 Oct 2026. Last week: Mon 28 Sep - Sun 4 Oct. This week starts Mon 5 Oct.
const TODAY = '2026-10-07'
const w = d => ({ id: 'w' + d, d, entries: [{ id: 'x', sets: [{ done: true }] }] })
const S = (days, planned = [], extra = {}) => ({
  routines: [{ id: 'r', name: 'Push', ex: [] }], week: Object.fromEntries(planned.map(d => [d, 'r'])), dayPlan: {}, workouts: days.map(w), breaks: [], ...extra
})

describe('weekStartOf', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartOf('2026-10-07')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05')
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05')
  })
})

describe('recapVisible', () => {
  it('shows Monday to Wednesday only', () => {
    expect(recapVisible('2026-10-05', null)).toBe(true)
    expect(recapVisible('2026-10-07', null)).toBe(true)
    expect(recapVisible('2026-10-08', null)).toBe(false)
    expect(recapVisible('2026-10-11', null)).toBe(false)
  })
  it('stays hidden once dismissed for this week, and forever after "never"', () => {
    expect(recapVisible('2026-10-07', '2026-10-05')).toBe(false)
    expect(recapVisible('2026-10-07', '2026-09-28')).toBe(true)     // dismissed last week: show again
    expect(recapVisible('2026-10-07', 'never')).toBe(false)
  })
})

describe('lastWeekStats', () => {
  it('counts last week sessions against last week plan', () => {
    const s = lastWeekStats(S(['2026-09-29', '2026-10-01', '2026-10-06'], [1, 3, 5]), TODAY)
    expect(s).toMatchObject({ sessions: 2, planned: 3, from: '2026-09-28', to: '2026-10-04' })
  })
  it('ignores sessions without a completed set', () => {
    const state = S([], [1]); state.workouts = [{ id: 'a', d: '2026-09-29', entries: [{ id: 'x', sets: [{ done: false }] }] }]
    expect(lastWeekStats(state, TODAY).sessions).toBe(0)
  })
  it('leaves planned breaks out of the plan, and honours rescheduled days', () => {
    const brk = S(['2026-09-29'], [1, 3, 5], { breaks: [{ from: '2026-09-30', to: '2026-10-04' }] })
    expect(lastWeekStats(brk, TODAY).planned).toBe(1)
    const moved = S([], [1], { dayPlan: { '2026-09-28': 'rest', '2026-09-30': 'r' } })
    expect(lastWeekStats(moved, TODAY).planned).toBe(1)
  })
  it('tolerates missing fields', () => {
    expect(lastWeekStats({ routines: [], week: {}, dayPlan: {}, workouts: [] }, TODAY)).toMatchObject({ sessions: 0, planned: 0 })
  })
})

describe('recapLine', () => {
  it('celebrates a plan fully done', () => expect(recapLine({ sessions: 3, planned: 3 })).toBe('You did everything you planned. Brilliant.'))
  it('celebrates more than planned', () => expect(recapLine({ sessions: 4, planned: 3 })).toBe('You did everything you planned. Brilliant.'))
  it('encourages a partial week', () => expect(recapLine({ sessions: 1, planned: 3 })).toBe('Every session counts. Nice week.'))
  it('welcomes people back after a week off, without reproach', () => expect(recapLine({ sessions: 0, planned: 3 })).toBe('A new week is a fresh start. One session is all it takes.'))
  it('is glad about training without a plan', () => expect(recapLine({ sessions: 2, planned: 0 })).toBe('You trained without a fixed plan. Great!'))
  it('has a neutral fallback', () => expect(recapLine({ sessions: 0, planned: 0 })).toBe('Ready for a new week?'))
})

describe('buildRecap', () => {
  const state = S(['2026-09-29', '2026-10-01', '2026-10-06'], [1, 3, 5])
  it('puts your week, streak, challenge and crew together', () => {
    const r = buildRecap(state, { crewSessions: 5, challenge: { title: 'Autumn', pct: 0.4 } }, TODAY)
    expect(r.sessions).toBe(2)
    expect(r.planned).toBe(3)
    expect(r.streak).toBeGreaterThanOrEqual(1)
    expect(r.challenge).toEqual({ title: 'Autumn', pct: 0.4 })
    expect(r.crewSessions).toBe(5)
    expect(r.line).toBe('Every session counts. Nice week.')
    expect(r.weekStart).toBe('2026-10-05')
  })
  it('keeps to personal figures when nothing is shared', () => {
    const r = buildRecap(state, null, TODAY)
    expect(r.crewSessions).toBeNull()
    expect(r.challenge).toBeNull()
  })
})
