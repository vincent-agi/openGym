import { describe, it, expect } from 'vitest'
import { effectiveLargeTouch } from './touch.js'

describe('effectiveLargeTouch', () => {
  it('is off by default for a profile with no mobility fields set', () => {
    expect(effectiveLargeTouch({})).toBe(false)
  })

  it('turns on automatically once a mobility profile field is set', () => {
    expect(effectiveLargeTouch({ mobilityLevel: 'wheelchair' })).toBe(true)
    expect(effectiveLargeTouch({ preferredPosture: 'Seated-Chair' })).toBe(true)
    expect(effectiveLargeTouch({ disabledLimbs: ['left_leg'] })).toBe(true)
  })

  it('an explicit Settings choice overrides the profile-derived default either way', () => {
    expect(effectiveLargeTouch({ mobilityLevel: 'wheelchair', largeTouchTargets: false })).toBe(false)
    expect(effectiveLargeTouch({ largeTouchTargets: true })).toBe(true)
  })
})
