import { describe, it, expect } from 'vitest'
import { addGoal, removeGoal, updateGoal, goalProgress } from './goals.js'

describe('addGoal / removeGoal / updateGoal', () => {
  it('appends to an empty or missing list', () => {
    expect(addGoal(undefined, { id: 'a' })).toEqual([{ id: 'a' }])
    expect(addGoal([{ id: 'a' }], { id: 'b' })).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('removes only the matching goal', () => {
    const goals = [{ id: 'a' }, { id: 'b' }]
    expect(removeGoal(goals, 'a')).toEqual([{ id: 'b' }])
  })

  it('merges a patch into the matching goal only', () => {
    const goals = [{ id: 'a', target: 100 }, { id: 'b', target: 50 }]
    expect(updateGoal(goals, 'a', { target: 110 })).toEqual([{ id: 'a', target: 110 }, { id: 'b', target: 50 }])
  })

  it('does not mutate the input list', () => {
    const goals = [{ id: 'a' }]
    addGoal(goals, { id: 'b' })
    expect(goals).toEqual([{ id: 'a' }])
  })
})

describe('goalProgress — lift', () => {
  const S = {
    workouts: [{ id: 'w1', d: '2026-01-01', start: 1, entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }]
  }
  it('computes progress from the best estimated 1RM for that exercise', () => {
    const goal = { type: 'lift', exerciseId: '0025', target: 130 }
    const p = goalProgress(S, goal)
    expect(p.current).toBeGreaterThan(100)
    expect(p.pct).toBeGreaterThan(0)
    expect(p.pct).toBeLessThan(1)
    expect(p.done).toBe(false)
  })

  it('reads as 0% when the exercise has no history at all', () => {
    const p = goalProgress(S, { type: 'lift', exerciseId: 'never-logged', target: 100 })
    expect(p).toEqual({ current: 0, target: 100, pct: 0, done: false })
  })

  it('is done once the estimate clears the target', () => {
    const p = goalProgress(S, { type: 'lift', exerciseId: '0025', target: 50 })
    expect(p.done).toBe(true)
    expect(p.pct).toBe(1)
  })
})

describe('goalProgress — bodyweight', () => {
  it('computes a 0-100% bar between the start value and the target, gaining', () => {
    const S = { bodyweight: [{ d: '2026-01-01', w: 75 }] }
    const goal = { type: 'bodyweight', target: 80, startValue: 70 }
    expect(goalProgress(S, goal).pct).toBeCloseTo(0.5, 5)
  })

  it('computes a 0-100% bar when the goal is to lose weight', () => {
    const S = { bodyweight: [{ d: '2026-01-01', w: 85 }] }
    const goal = { type: 'bodyweight', target: 80, startValue: 90 }
    expect(goalProgress(S, goal).pct).toBeCloseTo(0.5, 5)
  })

  it('is done within rounding of the target', () => {
    const S = { bodyweight: [{ d: '2026-01-01', w: 80.02 }] }
    expect(goalProgress(S, { type: 'bodyweight', target: 80, startValue: 70 }).done).toBe(true)
  })

  it('does not throw when nothing has been logged yet', () => {
    const p = goalProgress({ bodyweight: [] }, { type: 'bodyweight', target: 80, startValue: 70 })
    expect(p.current).toBe(70)
  })
})

describe('goalProgress — volume', () => {
  it('counts workouts from createdAt onward, up to an optional deadline', () => {
    const S = { workouts: [{ d: '2026-01-05' }, { d: '2026-01-10' }, { d: '2026-02-01' }] }
    const goal = { type: 'volume', target: 2, createdAt: new Date('2026-01-01').getTime(), deadline: '2026-01-31' }
    const p = goalProgress(S, goal)
    expect(p.current).toBe(2)
    expect(p.done).toBe(true)
  })

  it('excludes workouts logged before the goal was created', () => {
    const S = { workouts: [{ d: '2025-12-31' }, { d: '2026-01-05' }] }
    const goal = { type: 'volume', target: 5, createdAt: new Date('2026-01-01').getTime() }
    expect(goalProgress(S, goal).current).toBe(1)
  })
})
