import { EXDB as RAW_EXDB } from './exercises-data.js'
import { t } from './i18n.js'

// Postures a profile can set (issue #21) — also the full compatibility list an exercise gets
// when nothing marks it as needing legs, so an upper-body move is assumed fine lying down too.
export const POSTURES = ['Seated-Wheelchair', 'Seated-Chair', 'Lying-Bed', 'Standing-Support']
const LOWER_BODY_BP = new Set(['upper legs', 'lower legs'])
// Cardio machines you can do from a seated upper-body-only position (see issue #22 hints) —
// everything else under `bp: 'cardio'` (running, stepmill, stationary bike…) needs legs.
const UPPER_BODY_CARDIO_EQ = new Set(['upper body ergometer'])

// The bulk of the catalogue predates accessibility tagging (issue #22) — derive a conservative
// default from bodypart/equipment instead of hand-editing ~4000 entries. Exercises that already
// carry a `posture` (the new seeds) pass through untouched.
function withAccessibilityDefaults(e) {
  if (e.posture) return e
  const requiresLowerBody = LOWER_BODY_BP.has(e.bp) || (e.bp === 'cardio' && !UPPER_BODY_CARDIO_EQ.has(e.eq))
  return {
    ...e,
    requires_lower_body: requiresLowerBody,
    posture: requiresLowerBody ? ['Standing-Support'] : POSTURES,
    is_unilateral_supported: false,
    accessibility_tags: [],
  }
}

export const EXDB = RAW_EXDB.map(withAccessibilityDefaults)
export const EXIDX = {}
EXDB.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(EXDB.map(e => e.bp))].sort()

// Whether a profile (issue #21: mobilityLevel / disabledLimbs / preferredPosture) can be shown
// this exercise. Every field unset (the default for existing users) means "don't filter" — a
// profile only narrows the catalogue once it opts in.
export function compatibleWithProfile(ex, st) {
  if (st.preferredPosture && ex.posture && !ex.posture.includes(st.preferredPosture)) return false
  const legsUnavailable = st.mobilityLevel === 'wheelchair' || (st.disabledLimbs || []).some(l => l.endsWith('_leg'))
  if (legsUnavailable && ex.requires_lower_body) return false
  return true
}
const hasProfileFilter = st => !!(st.mobilityLevel || st.preferredPosture || (st.disabledLimbs || []).length)

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => delete EXIDX[id])
  customIds = (list || []).map(e => e.id)
  ;(list || []).forEach(e => { EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find. EXIDX
// lookups (history, past workouts) stay unfiltered so an exercise hidden by a profile change
// still renders wherever it was already logged.
export const allExercises = st => {
  const list = [...(st.customEx || []), ...EXDB]
  return hasProfileFilter(st) ? list.filter(e => compatibleWithProfile(e, st)) : list
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment.
const IMG_BASE = import.meta.env.VITE_IMG_BASE || 'img/'
const GIF_BASE = import.meta.env.VITE_GIF_BASE || 'gif/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }
