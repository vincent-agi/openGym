import { describe, it, expect } from 'vitest'
import { isWheelchairProfile, pressureReliefDue, DEFAULT_PRESSURE_RELIEF_INTERVAL } from './pressureRelief.js'

describe('isWheelchairProfile', () => {
  it('is true for mobilityLevel wheelchair or preferredPosture Seated-Wheelchair', () => {
    expect(isWheelchairProfile({ mobilityLevel: 'wheelchair' })).toBe(true)
    expect(isWheelchairProfile({ preferredPosture: 'Seated-Wheelchair' })).toBe(true)
  })

  it('is false for any other profile, including a different seated posture', () => {
    expect(isWheelchairProfile({})).toBe(false)
    expect(isWheelchairProfile({ mobilityLevel: 'partial' })).toBe(false)
    expect(isWheelchairProfile({ preferredPosture: 'Seated-Chair' })).toBe(false)
  })
})

describe('pressureReliefDue', () => {
  const base = { mobilityLevel: 'wheelchair', pressureRelief: { on: true, intervalMin: 20 }, active: { start: 0 } }

  it('is false when the setting is off', () => {
    expect(pressureReliefDue({ ...base, pressureRelief: { on: false } }, 999999)).toBe(false)
  })

  it('is false for a profile the reminder is not offered to, even with the setting on', () => {
    expect(pressureReliefDue({ ...base, mobilityLevel: null }, 999999)).toBe(false)
  })

  it('is false with no active workout', () => {
    expect(pressureReliefDue({ ...base, active: null }, 999999)).toBe(false)
  })

  it('is false before the interval has elapsed since session start', () => {
    expect(pressureReliefDue(base, 10 * 60000)).toBe(false)
  })

  it('is true once the interval has elapsed since session start', () => {
    expect(pressureReliefDue(base, 20 * 60000)).toBe(true)
  })

  it('measures from the last reminder, not the session start, once one has fired', () => {
    const S = { ...base, active: { start: 0, lastPressureReliefAt: 30 * 60000 } }
    expect(pressureReliefDue(S, 40 * 60000)).toBe(false)
    expect(pressureReliefDue(S, 50 * 60000)).toBe(true)
  })

  it('falls back to the default interval when unset', () => {
    const S = { ...base, pressureRelief: { on: true } }
    expect(pressureReliefDue(S, (DEFAULT_PRESSURE_RELIEF_INTERVAL - 1) * 60000)).toBe(false)
    expect(pressureReliefDue(S, DEFAULT_PRESSURE_RELIEF_INTERVAL * 60000)).toBe(true)
  })
})
