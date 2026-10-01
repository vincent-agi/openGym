import { describe, it, expect } from 'vitest'
import { EXDB, EXIDX, allExercises, compatibleWithProfile, POSTURES } from './exercises.js'

const noProfile = { customEx: [] }

describe('accessibility defaults', () => {
  it('derives requires_lower_body / posture for exercises that predate the schema', () => {
    const squat = EXDB.find(e => e.bp === 'upper legs')
    expect(squat.requires_lower_body).toBe(true)
    expect(squat.posture).toEqual(['Standing-Support'])

    const curl = EXDB.find(e => e.bp === 'upper arms' && !e.id.startsWith('acc-'))
    expect(curl.requires_lower_body).toBe(false)
    expect(curl.posture).toEqual(POSTURES)
  })

  it('every exercise exposes the new accessibility fields', () => {
    EXDB.forEach(e => {
      expect(typeof e.requires_lower_body).toBe('boolean')
      expect(Array.isArray(e.posture)).toBe(true)
      expect(typeof e.is_unilateral_supported).toBe('boolean')
      expect(Array.isArray(e.accessibility_tags)).toBe(true)
    })
  })
})

describe('seated/wheelchair seeds (issue #22)', () => {
  const seeds = EXDB.filter(e => e.id.startsWith('acc-'))

  it('adds exactly 10 new exercises', () => {
    expect(seeds).toHaveLength(10)
  })

  it('every seed is upper-body, seated-compatible and fully described', () => {
    seeds.forEach(e => {
      expect(e.requires_lower_body).toBe(false)
      expect(e.posture).toEqual(expect.arrayContaining(['Seated-Wheelchair', 'Seated-Chair']))
      expect(e.accessibility_tags).toContain('wheelchair')
      expect(e.n).toBeTruthy()
      expect(e.bp).toBeTruthy()
      expect(e.tg).toBeTruthy()
      expect(e.st.length).toBeGreaterThan(0)
    })
  })

  it('tags the pressure-relief exercise for the reminder feature', () => {
    const chairPushUp = seeds.find(e => e.id === 'acc-0007')
    expect(chairPushUp.accessibility_tags).toContain('pressure-relief')
  })

  it('resolves through EXIDX like any other exercise', () => {
    expect(EXIDX['acc-0007'].n).toBe('Chair Push-Up / Pressure Relief')
  })
})

describe('compatibleWithProfile', () => {
  const wheelchairEx = EXIDX['acc-0001']
  const legEx = EXDB.find(e => e.bp === 'upper legs')

  it('allows everything when no profile field is set', () => {
    expect(compatibleWithProfile(legEx, {})).toBe(true)
  })

  it('excludes lower-body exercises for a wheelchair profile', () => {
    expect(compatibleWithProfile(legEx, { mobilityLevel: 'wheelchair' })).toBe(false)
    expect(compatibleWithProfile(wheelchairEx, { mobilityLevel: 'wheelchair' })).toBe(true)
  })

  it('excludes lower-body exercises when a leg is in disabledLimbs', () => {
    expect(compatibleWithProfile(legEx, { disabledLimbs: ['left_leg'] })).toBe(false)
  })

  it('filters by preferredPosture against the exercise posture list', () => {
    expect(compatibleWithProfile(wheelchairEx, { preferredPosture: 'Seated-Wheelchair' })).toBe(true)
    expect(compatibleWithProfile(legEx, { preferredPosture: 'Seated-Wheelchair' })).toBe(false)
  })
})

describe('allExercises', () => {
  it('returns the full catalogue when no profile is set', () => {
    expect(allExercises(noProfile).length).toBe(EXDB.length)
  })

  it('narrows the catalogue once a profile field is set', () => {
    const filtered = allExercises({ ...noProfile, mobilityLevel: 'wheelchair' })
    expect(filtered.length).toBeLessThan(EXDB.length)
    expect(filtered.some(e => e.requires_lower_body)).toBe(false)
  })
})
