import { describe, it, expect } from 'vitest'
import { CHEER_EMOJI, cheerLine, timeAgo } from './cheers.js'
import { CHEER_EMOJI as API_CHEER_EMOJI } from '../../../api/feed.js'

describe('CHEER_EMOJI', () => {
  it('is exactly the list the API accepts, in the same order', () => {
    expect([...CHEER_EMOJI]).toEqual([...API_CHEER_EMOJI])
  })
})

describe('cheerLine', () => {
  it('repeats each emoji by its count', () => {
    expect(cheerLine([{ emoji: '👏', count: 1 }, { emoji: '🔥', count: 2 }])).toBe('👏🔥🔥')
  })
  it('is empty without cheers', () => {
    expect(cheerLine([])).toBe('')
    expect(cheerLine(undefined)).toBe('')
  })
})

describe('timeAgo', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  const ago = ms => timeAgo(now - ms, now)
  it('says "just now" within a minute', () => {
    expect(ago(20_000)).toEqual({ template: 'Just now', n: 0 })
  })
  it('counts minutes then hours', () => {
    expect(ago(5 * 60_000)).toEqual({ template: '{0} min ago', n: 5 })
    expect(ago(3 * 3_600_000)).toEqual({ template: '{0} h ago', n: 3 })
  })
  it('says yesterday, then days', () => {
    expect(ago(30 * 3_600_000)).toEqual({ template: 'Yesterday', n: 1 })
    expect(ago(4 * 86_400_000)).toEqual({ template: '{0} days ago', n: 4 })
  })
  it('never goes negative when clocks disagree', () => {
    expect(timeAgo(now + 60_000, now)).toEqual({ template: 'Just now', n: 0 })
  })
})
