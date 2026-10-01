import { describe, it, expect } from 'vitest'
import { calcTargets, latestWeightKg, dayTotals } from './nutrition.js'

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
