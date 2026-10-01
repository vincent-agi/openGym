// Session-level subjective effort — the classic 1-10 Borg scale (issue #25). This is a
// different thing from the per-set `rir`/`rpe` effort column in history.js (EFFORT): that one
// is a resistance-training "reps in reserve" flavored rating on a single SET, already shipped
// and left untouched here. This one rates how the whole SESSION felt, on the scale cardiac/
// exercise-physiology contexts call Borg RPE/CR10 — the metric that makes sense for someone
// whose training has no meaningful heart-rate or lower-body load signal to fall back on.
// Stored as `workout.sessionRpe` (1-10, or absent if never logged).
export const BORG_SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
export const BORG_LABELS = {
  1: 'Very light', 2: 'Light', 3: 'Light', 4: 'Moderate', 5: 'Somewhat hard',
  6: 'Hard', 7: 'Hard', 8: 'Very hard', 9: 'Very hard', 10: 'Maximal effort',
}
export const borgLabel = n => BORG_LABELS[n] || ''
