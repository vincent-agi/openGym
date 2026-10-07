// S.measurements is keyed by ISO date, one entry per day: { waist?, chest?, arms?, hips?,
// bodyFatPct? } — every field optional, same "absent means not logged, not zero" rule as the
// nutrition targets.
export const MEASUREMENT_FIELDS = [
  { key: 'waist', label: 'Waist', unit: 'cm' },
  { key: 'chest', label: 'Chest', unit: 'cm' },
  { key: 'arms', label: 'Arms', unit: 'cm' },
  { key: 'hips', label: 'Hips', unit: 'cm' },
  { key: 'bodyFatPct', label: 'Body fat', unit: '%' }
]

// Chart points for one field, oldest first, skipping dates where that field wasn't logged —
// a gap in waist measurements shouldn't interpolate through days only chest was logged.
export function seriesFor(measurements, field) {
  return Object.entries(measurements || {})
    .filter(([, entry]) => entry && entry[field] != null)
    .map(([iso, entry]) => ({ t: new Date(iso + 'T12:00:00').getTime(), y: entry[field], d: iso }))
    .sort((a, b) => a.t - b.t)
}

// Merges a partial reading into the day's entry — set fields are added/overwritten, fields
// left out of `patch` keep whatever was already logged for that day (a second entry adding
// just hips shouldn't erase a waist reading logged earlier the same day).
export function setMeasurement(measurements, iso, patch) {
  return { ...measurements, [iso]: { ...(measurements || {})[iso], ...patch } }
}

export function deleteMeasurement(measurements, iso) {
  const next = { ...measurements }
  delete next[iso]
  return next
}
