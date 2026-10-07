// Pressure-relief / chair push-up reminders (issue #26). A full-time wheelchair user is at
// risk of pressure sores from sustained seated load, and benefits from being nudged to shift
// weight or do a chair push-up periodically — but only this profile, and only once they've
// opted in, since the reminder means nothing to anyone else and alarm fatigue is the whole
// risk being managed here.
export const isWheelchairProfile = S =>
  S.mobilityLevel === 'wheelchair' || S.preferredPosture === 'Seated-Wheelchair'

export const PRESSURE_RELIEF_INTERVALS = [10, 15, 20, 30, 45]
export const DEFAULT_PRESSURE_RELIEF_INTERVAL = 20

// The seated exercise this reminder links to (issue #22's seed, tagged `pressure-relief`).
export const PRESSURE_RELIEF_EXERCISE_ID = 'acc-0007'

// Whether a new rest period should carry the reminder — gated on opt-in + profile, and on
// enough *total session time* having passed since the last one (not "every rest", which is
// exactly the alarm-fatigue case the setting exists to avoid).
export function pressureReliefDue(S, now = Date.now()) {
  const cfg = S.pressureRelief
  if (!cfg?.on || !isWheelchairProfile(S) || !S.active) return false
  const last = S.active.lastPressureReliefAt || S.active.start
  const intervalMs = (cfg.intervalMin || DEFAULT_PRESSURE_RELIEF_INTERVAL) * 60000
  return now - last >= intervalMs
}
