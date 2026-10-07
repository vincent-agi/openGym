import { describe, it, expect } from 'vitest'
import { CATALOG, badgeInfo, newBadges } from './badges.js'
import { BADGES } from '../../../api/badges.js'

describe('catalogue', () => {
  it('describes exactly the badges the API can award, in the same order', () => {
    expect(CATALOG.map(b => b.id)).toEqual([...BADGES])
  })
  it('gives each badge a name and a one-line description', () => {
    for (const b of CATALOG) { expect(b.name.length).toBeGreaterThan(2); expect(b.description.length).toBeGreaterThan(10) }
  })
  it('is about habits and kindness, never about strength or rank', () => {
    const text = CATALOG.map(b => `${b.name} ${b.description}`).join(' ').toLowerCase()
    for (const bad of ['heaviest', 'strongest', 'kg', 'lb', 'winner', 'first place', 'best', 'beat', 'rank']) expect(text).not.toContain(bad)
  })
})

describe('badgeInfo', () => {
  it('finds a badge by id and tolerates an unknown one', () => {
    expect(badgeInfo('hat-trick').name).toBe('Hat-trick')
    expect(badgeInfo('from-the-future')).toEqual({ id: 'from-the-future', name: 'from-the-future', description: '' })
  })
})

describe('newBadges', () => {
  const earned = [{ id: 'first-week', date: '2026-09-01' }, { id: 'hat-trick', date: '2026-09-10' }]
  it('lists earned badges not seen before', () => {
    expect(newBadges(earned, ['first-week']).map(b => b.id)).toEqual(['hat-trick'])
  })
  it('is empty when everything was seen, or nothing was earned', () => {
    expect(newBadges(earned, ['first-week', 'hat-trick'])).toEqual([])
    expect(newBadges([], [])).toEqual([])
    expect(newBadges(undefined, undefined)).toEqual([])
  })
  it('treats a first visit as everything new, so the caller can decide to stay quiet', () => {
    expect(newBadges(earned, null)).toHaveLength(2)
  })
})
