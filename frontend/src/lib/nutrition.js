// Calorie/macro target estimate from bodyweight alone — the profile has no height or age
// field (DEF in store/useStore.js), so this uses a weight × activity-level multiplier instead
// of a Mifflin-St Jeor formula, which needs both. Good enough for a starting target; the user
// can always override targets by hand once the tracker view (issue #3) ships.
const LB_TO_KG = 0.45359237

const ACTIVITY_KCAL_PER_KG = { sedentary: 27, light: 30, moderate: 33, active: 37, very_active: 41 }
const GOAL_ADJUST = { cut: -0.175, maintain: 0, bulk: 0.125 }
const PROTEIN_G_PER_KG = 1.8
const FAT_KCAL_SHARE = 0.25

export const ACTIVITY_LEVELS = Object.keys(ACTIVITY_KCAL_PER_KG)
export const GOALS = Object.keys(GOAL_ADJUST)

// { kcal, protein, carbs, fat } (grams, kcal) or null if weight isn't known yet.
export function calcTargets({ weightKg, goal = 'maintain', activityLevel = 'moderate' }) {
  if (!weightKg || weightKg <= 0) return null
  const perKg = ACTIVITY_KCAL_PER_KG[activityLevel] ?? ACTIVITY_KCAL_PER_KG.moderate
  const adjust = GOAL_ADJUST[goal] ?? 0
  const kcal = Math.round(weightKg * perKg * (1 + adjust))
  const protein = Math.round(weightKg * PROTEIN_G_PER_KG)
  const fat = Math.round((kcal * FAT_KCAL_SHARE) / 9)
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4))
  return { kcal, protein, carbs, fat }
}

// Most recent bodyweight entry, normalized to kg regardless of the profile's display unit.
export function latestWeightKg(S) {
  const log = S.bodyweight || []
  const last = log[log.length - 1]
  if (!last) return null
  return S.unit === 'lb' ? last.w * LB_TO_KG : last.w
}

// Summed kcal/macros logged for one ISO date — shared by the Nutrition view and the Home
// summary card so the two never drift on what "today's total" means.
export function dayTotals(S, iso) {
  const entries = S.nutrition?.log?.[iso] || []
  return entries.reduce((a, e) => ({
    kcal: a.kcal + (e.kcal || 0), protein: a.protein + (e.protein || 0),
    carbs: a.carbs + (e.carbs || 0), fat: a.fat + (e.fat || 0)
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 })
}

// Pure add/edit/delete reducers over S.nutrition.log, kept out of sheets.jsx (which can't be
// unit tested without a DOM — useStore.js touches `document` at module scope) so the actual
// logic has real test coverage instead of a parallel copy living only in the test file.
export function addLogEntry(log, iso, entry) {
  return { ...log, [iso]: [...(log[iso] || []), entry] }
}
export function updateLogEntry(log, iso, id, patch) {
  const day = log[iso] || []
  return { ...log, [iso]: day.map(e => (e.id === id ? { ...e, ...patch } : e)) }
}
export function removeLogEntry(log, iso, id) {
  const day = log[iso] || []
  return { ...log, [iso]: day.filter(e => e.id !== id) }
}
