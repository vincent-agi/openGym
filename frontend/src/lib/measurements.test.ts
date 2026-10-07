import { describe, it, expect } from 'vitest'
import { seriesFor, setMeasurement, deleteMeasurement } from './measurements.js'

describe('seriesFor', () => {
  it('returns points sorted oldest first, regardless of key order', () => {
    const m = { '2026-02-01': { waist: 81 }, '2026-01-01': { waist: 82 } }
    const s = seriesFor(m, 'waist')
    expect(s.map(p => p.d)).toEqual(['2026-01-01', '2026-02-01'])
    expect(s.map(p => p.y)).toEqual([82, 81])
  })

  it('skips days where the requested field was not logged', () => {
    const m = { '2026-01-01': { waist: 82 }, '2026-01-02': { chest: 100 } }
    expect(seriesFor(m, 'waist')).toHaveLength(1)
    expect(seriesFor(m, 'chest')).toHaveLength(1)
  })

  it('returns an empty array for an empty or missing measurements object', () => {
    expect(seriesFor({}, 'waist')).toEqual([])
    expect(seriesFor(undefined, 'waist')).toEqual([])
  })

  it('does not treat a logged 0 as missing', () => {
    const m = { '2026-01-01': { bodyFatPct: 0 } }
    expect(seriesFor(m, 'bodyFatPct')).toHaveLength(1)
  })
})

describe('setMeasurement', () => {
  it('creates a new day entry', () => {
    const next = setMeasurement({}, '2026-01-01', { waist: 80 })
    expect(next['2026-01-01']).toEqual({ waist: 80 })
  })

  it('merges into an existing day without dropping other fields', () => {
    const m = { '2026-01-01': { waist: 80 } }
    const next = setMeasurement(m, '2026-01-01', { chest: 100 })
    expect(next['2026-01-01']).toEqual({ waist: 80, chest: 100 })
  })

  it('overwrites a field already set for that day', () => {
    const m = { '2026-01-01': { waist: 80 } }
    const next = setMeasurement(m, '2026-01-01', { waist: 79 })
    expect(next['2026-01-01']).toEqual({ waist: 79 })
  })

  it('does not mutate the input', () => {
    const m = { '2026-01-01': { waist: 80 } }
    setMeasurement(m, '2026-01-01', { chest: 100 })
    expect(m['2026-01-01']).toEqual({ waist: 80 })
  })
})

describe('deleteMeasurement', () => {
  it('removes the day entirely', () => {
    const m = { '2026-01-01': { waist: 80 }, '2026-01-02': { waist: 79 } }
    const next = deleteMeasurement(m, '2026-01-01')
    expect(next).toEqual({ '2026-01-02': { waist: 79 } })
  })

  it('tolerates deleting a day that was never logged', () => {
    expect(deleteMeasurement({}, '2026-01-01')).toEqual({})
  })
})
