import { describe, it, expect } from 'vitest'
import { MAX_BREAK_DAYS, planBreak, activeBreak, clearBreaks } from './breaks.js'

describe('planBreak', () => {
  it('adds a break and keeps the list ordered by start', () => {
    const list = planBreak([{ from: '2026-11-01', to: '2026-11-05' }], '2026-10-07', '2026-10-10')
    expect(list).toEqual([{ from: '2026-10-07', to: '2026-10-10' }, { from: '2026-11-01', to: '2026-11-05' }])
  })
  it('never lasts more than 14 days', () => {
    expect(MAX_BREAK_DAYS).toBe(14)
    expect(planBreak([], '2026-10-01', '2026-12-31')).toEqual([{ from: '2026-10-01', to: '2026-10-14' }])
  })
  it('accepts exactly 14 days and a single day', () => {
    expect(planBreak([], '2026-10-01', '2026-10-14')[0].to).toBe('2026-10-14')
    expect(planBreak([], '2026-10-01', '2026-10-01')).toEqual([{ from: '2026-10-01', to: '2026-10-01' }])
  })
  it('refuses reversed or malformed dates by returning the list unchanged', () => {
    const list = [{ from: '2026-10-01', to: '2026-10-02' }]
    expect(planBreak(list, '2026-10-10', '2026-10-01')).toBe(list)
    expect(planBreak(list, 'x', '2026-10-01')).toBe(list)
    expect(planBreak(undefined, 'x', 'y')).toEqual([])
  })
  it('does not mutate the list', () => {
    const list = [{ from: '2026-10-01', to: '2026-10-02' }]
    planBreak(list, '2026-10-05', '2026-10-06')
    expect(list).toHaveLength(1)
  })
  it('drops past breaks older than 90 days so the state does not grow forever', () => {
    const old = { from: '2026-01-01', to: '2026-01-05' }
    expect(planBreak([old], '2026-10-07', '2026-10-08', '2026-10-07')).toEqual([{ from: '2026-10-07', to: '2026-10-08' }])
  })
})

describe('activeBreak', () => {
  const list = [{ from: '2026-10-01', to: '2026-10-05' }, { from: '2026-10-10', to: '2026-10-12' }]
  it('finds the break covering a day, end included', () => {
    expect(activeBreak(list, '2026-10-05')).toEqual(list[0])
    expect(activeBreak(list, '2026-10-10')).toEqual(list[1])
  })
  it('reports the next upcoming break when none is running', () => {
    expect(activeBreak(list, '2026-10-07')).toEqual(list[1])
  })
  it('is null when everything is in the past or the list is empty', () => {
    expect(activeBreak(list, '2026-11-01')).toBeNull()
    expect(activeBreak(undefined, '2026-10-01')).toBeNull()
  })
})

describe('clearBreaks', () => {
  it('removes the running and upcoming breaks but keeps history', () => {
    const list = [{ from: '2026-09-01', to: '2026-09-03' }, { from: '2026-10-05', to: '2026-10-08' }, { from: '2026-10-20', to: '2026-10-22' }]
    expect(clearBreaks(list, '2026-10-07')).toEqual([{ from: '2026-09-01', to: '2026-09-03' }])
  })
})
