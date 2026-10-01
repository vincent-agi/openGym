// Large touch targets (issue #24). Kept out of store/useStore.js, which runs browser-only
// side effects (document listeners) at import time, so this pure function stays unit-testable.

// Whether the active-workout/rest-timer screens should use larger tap targets right now — an
// explicit Settings choice if there is one, otherwise on by default once any mobility/
// accessibility profile field is set (issue #21).
export const effectiveLargeTouch = S =>
  S.largeTouchTargets != null ? !!S.largeTouchTargets : !!(S.mobilityLevel || S.preferredPosture || (S.disabledLimbs || []).length)
