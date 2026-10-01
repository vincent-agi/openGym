import { describe, it, expect } from 'vitest'
import { calcTargets, latestWeightKg, dayTotals, addLogEntry, updateLogEntry, removeLogEntry, markPlannedMealEaten } from './nutrition.js'

describe('calcTargets', () => {
  it('returns null without a known weight', () => {
    expect(calcTargets({ weightKg: null })).toBe(null)
    expect(calcTargets({ weightKg: 0 })).toBe(null)
  })

  it('maintain holds calories flat at the activity baseline', () => {
    const r = calcTargets({ weightKg: 80, goal: 'maintain', activityLevel: 'moderate' })
    expect(r.kcal).toBe(Math.round(80 * 33))
  })

  it('bulk is above maintain, cut is below, same weight and activity', () => {
    const base = { weightKg: 80, activityLevel: 'moderate' }
    const cut = calcTargets({ ...base, goal: 'cut' })
    const maintain = calcTargets({ ...base, goal: 'maintain' })
    const bulk = calcTargets({ ...base, goal: 'bulk' })
    expect(cut.kcal).toBeLessThan(maintain.kcal)
    expect(bulk.kcal).toBeGreaterThan(maintain.kcal)
  })

  it('protein target scales with bodyweight, independent of goal', () => {
    const r = calcTargets({ weightKg: 80, goal: 'cut' })
    expect(r.protein).toBe(Math.round(80 * 1.8))
  })

  it('macros add back up to roughly the calorie target', () => {
    const r = calcTargets({ weightKg: 72, goal: 'bulk', activityLevel: 'active' })
    const recomposed = r.protein * 4 + r.carbs * 4 + r.fat * 9
    expect(Math.abs(recomposed - r.kcal)).toBeLessThan(10)
  })

  it('higher activity level raises the target at the same weight and goal', () => {
    const base = { weightKg: 80, goal: 'maintain' }
    const sedentary = calcTargets({ ...base, activityLevel: 'sedentary' })
    const active = calcTargets({ ...base, activityLevel: 'very_active' })
    expect(active.kcal).toBeGreaterThan(sedentary.kcal)
  })

  it('unknown activity level falls back to moderate rather than throwing', () => {
    const r = calcTargets({ weightKg: 80, activityLevel: 'nonsense' })
    expect(r.kcal).toBe(Math.round(80 * 33))
  })

  it('handles a very low bodyweight without going negative anywhere', () => {
    const r = calcTargets({ weightKg: 35, goal: 'cut', activityLevel: 'sedentary' })
    expect(r.kcal).toBeGreaterThan(0)
    expect(r.protein).toBeGreaterThan(0)
    expect(r.carbs).toBeGreaterThanOrEqual(0)
    expect(r.fat).toBeGreaterThan(0)
  })

  it('handles a very high bodyweight without the carbs floor going negative', () => {
    const r = calcTargets({ weightKg: 180, goal: 'bulk', activityLevel: 'very_active' })
    expect(r.carbs).toBeGreaterThanOrEqual(0)
    expect(r.kcal).toBe(Math.round(180 * 41 * 1.125))
  })

  it('rejects a negative weight the same as no weight at all', () => {
    expect(calcTargets({ weightKg: -10 })).toBe(null)
  })
})

describe('latestWeightKg', () => {
  it('returns null with no bodyweight entries logged', () => {
    expect(latestWeightKg({ unit: 'kg', bodyweight: [] })).toBe(null)
  })

  it('returns the most recent entry as-is when the unit is kg', () => {
    const S = { unit: 'kg', bodyweight: [{ d: '2026-01-01', w: 79 }, { d: '2026-02-01', w: 80 }] }
    expect(latestWeightKg(S)).toBe(80)
  })

  it('converts the most recent entry from lb to kg', () => {
    const S = { unit: 'lb', bodyweight: [{ d: '2026-02-01', w: 176.37 }] }
    expect(latestWeightKg(S)).toBeCloseTo(80, 0)
  })
})

describe('dayTotals', () => {
  it('sums all entries logged for the given date', () => {
    const S = { nutrition: { log: { '2026-01-01': [
      { kcal: 400, protein: 30, carbs: 40, fat: 10 },
      { kcal: 200, protein: 10, carbs: 20, fat: 5 }
    ] } } }
    expect(dayTotals(S, '2026-01-01')).toEqual({ kcal: 600, protein: 40, carbs: 60, fat: 15 })
  })

  it('returns all-zero totals for a date with nothing logged', () => {
    expect(dayTotals({ nutrition: { log: {} } }, '2026-01-01')).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })

  it('tolerates a profile with no nutrition key at all', () => {
    expect(dayTotals({}, '2026-01-01')).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
  })
})

describe('addLogEntry', () => {
  // Regression: a profile saved before S.nutrition.mealPlan existed keeps the old shape after
  // useStore's shallow Object.assign(clone(DEF), state) merge — s.nutrition.mealPlan is
  // genuinely undefined on a real upgraded profile, not just an empty object. Caught by
  // exercising the actual UI in a browser, not by build or the test suite as it stood then.
  it('tolerates an undefined log (profile saved before this field existed)', () => {
    const next = addLogEntry(undefined, '2026-01-01', { id: 'a', kcal: 100 })
    expect(next['2026-01-01']).toEqual([{ id: 'a', kcal: 100 }])
  })

  it('appends to an empty day without touching other days', () => {
    const log = { '2026-01-02': [{ id: 'keep' }] }
    const next = addLogEntry(log, '2026-01-01', { id: 'a', kcal: 100 })
    expect(next['2026-01-01']).toEqual([{ id: 'a', kcal: 100 }])
    expect(next['2026-01-02']).toEqual([{ id: 'keep' }])
  })

  it('appends to an existing day, keeping prior entries', () => {
    const log = { '2026-01-01': [{ id: 'a', kcal: 100 }] }
    const next = addLogEntry(log, '2026-01-01', { id: 'b', kcal: 200 })
    expect(next['2026-01-01']).toEqual([{ id: 'a', kcal: 100 }, { id: 'b', kcal: 200 }])
  })

  it('does not mutate the input log', () => {
    const log = { '2026-01-01': [{ id: 'a', kcal: 100 }] }
    addLogEntry(log, '2026-01-01', { id: 'b', kcal: 200 })
    expect(log['2026-01-01']).toEqual([{ id: 'a', kcal: 100 }])
  })
})

describe('updateLogEntry', () => {
  it('merges a patch into the matching entry only', () => {
    const log = { '2026-01-01': [{ id: 'a', kcal: 100 }, { id: 'b', kcal: 200 }] }
    const next = updateLogEntry(log, '2026-01-01', 'a', { kcal: 150 })
    expect(next['2026-01-01']).toEqual([{ id: 'a', kcal: 150 }, { id: 'b', kcal: 200 }])
  })

  it('is a no-op when the id is not found', () => {
    const log = { '2026-01-01': [{ id: 'a', kcal: 100 }] }
    const next = updateLogEntry(log, '2026-01-01', 'missing', { kcal: 999 })
    expect(next['2026-01-01']).toEqual([{ id: 'a', kcal: 100 }])
  })

  it('tolerates an undefined log', () => {
    expect(updateLogEntry(undefined, '2026-01-01', 'a', { kcal: 1 })['2026-01-01']).toEqual([])
  })
})

describe('removeLogEntry', () => {
  it('removes only the matching entry', () => {
    const log = { '2026-01-01': [{ id: 'a' }, { id: 'b' }] }
    const next = removeLogEntry(log, '2026-01-01', 'a')
    expect(next['2026-01-01']).toEqual([{ id: 'b' }])
  })

  it('tolerates removing from a day with no entries', () => {
    const next = removeLogEntry({}, '2026-01-01', 'a')
    expect(next['2026-01-01']).toEqual([])
  })

  it('tolerates an undefined log', () => {
    expect(removeLogEntry(undefined, '2026-01-01', 'a')['2026-01-01']).toEqual([])
  })
})

describe('markPlannedMealEaten', () => {
  it('tolerates an undefined log and mealPlan (profile saved before mealPlan existed)', () => {
    const r = markPlannedMealEaten(undefined, undefined, '2026-01-01', 'p1')
    expect(r).toEqual({ log: {}, mealPlan: {} })
  })

  it('moves the planned meal into the log and out of the plan', () => {
    const mealPlan = { '2026-01-01': [{ id: 'p1', ts: 1, name: 'Oats', kcal: 300, protein: 10, carbs: 50, fat: 5 }] }
    const r = markPlannedMealEaten({}, mealPlan, '2026-01-01', 'p1')
    expect(r.mealPlan['2026-01-01']).toEqual([])
    expect(r.log['2026-01-01']).toHaveLength(1)
    expect(r.log['2026-01-01'][0]).toMatchObject({ name: 'Oats', kcal: 300, protein: 10, carbs: 50, fat: 5 })
  })

  it('gives the moved entry a fresh id, independent from the plan entry', () => {
    const mealPlan = { '2026-01-01': [{ id: 'p1', ts: 1, name: 'Oats', kcal: 300, protein: 10, carbs: 50, fat: 5 }] }
    const r = markPlannedMealEaten({}, mealPlan, '2026-01-01', 'p1')
    expect(r.log['2026-01-01'][0].id).not.toBe('p1')
  })

  it('is a no-op when the planned id is not found', () => {
    const log = { '2026-01-01': [] }
    const mealPlan = { '2026-01-01': [{ id: 'other' }] }
    const r = markPlannedMealEaten(log, mealPlan, '2026-01-01', 'missing')
    expect(r.log).toBe(log)
    expect(r.mealPlan).toBe(mealPlan)
  })

  it('leaves other planned meals for the same day untouched', () => {
    const mealPlan = { '2026-01-01': [{ id: 'p1', name: 'Oats' }, { id: 'p2', name: 'Rice' }] }
    const r = markPlannedMealEaten({}, mealPlan, '2026-01-01', 'p1')
    expect(r.mealPlan['2026-01-01']).toEqual([{ id: 'p2', name: 'Rice' }])
  })
})
