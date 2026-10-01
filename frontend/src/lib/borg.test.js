import { describe, it, expect } from 'vitest'
import { BORG_SCALE, borgLabel } from './borg.js'

describe('BORG_SCALE', () => {
  it('is the 10 whole-number values from 1 to 10 — big tappable targets, not a slider', () => {
    expect(BORG_SCALE).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

describe('borgLabel', () => {
  it('has a label for every value on the scale', () => {
    BORG_SCALE.forEach(n => expect(borgLabel(n)).toBeTruthy())
  })

  it('reads light at the bottom and maximal at the top', () => {
    expect(borgLabel(1)).toMatch(/light/i)
    expect(borgLabel(10)).toMatch(/maximal/i)
  })

  it('returns an empty string outside the 1-10 range', () => {
    expect(borgLabel(0)).toBe('')
    expect(borgLabel(11)).toBe('')
  })
})
