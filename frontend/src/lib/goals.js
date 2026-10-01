import { best1RM } from './onerm.js'
import { lastBW } from './history.js'

export const GOAL_TYPES = ['lift', 'bodyweight', 'volume']

// { id, type: 'lift'|'bodyweight'|'volume', exerciseId? (lift only), target, deadline? (ISO
// date), createdAt (ms), startValue? (bodyweight only — the reading at creation time, so
// progress can be a 0-100% bar in either direction, gaining or losing) }
export function addGoal(goals, goal) { return [...(goals || []), goal] }
export function removeGoal(goals, id) { return (goals || []).filter(g => g.id !== id) }
export function updateGoal(goals, id, patch) { return (goals || []).map(g => (g.id === id ? { ...g, ...patch } : g)) }

const clampPct = p => Math.min(1, Math.max(0, p))
const towardTarget = (current, target) => ({ current, target, pct: target > 0 ? clampPct(current / target) : 0, done: current >= target })

// { current, target, pct (0-1), done } — current is whatever unit the goal's type implies
// (kg for lift/bodyweight, a workout count for volume). Never throws on a goal that can't be
// evaluated yet (no exerciseId set, no bodyweight logged) — just reads as 0% so far.
export function goalProgress(S, goal) {
  if (goal.type === 'lift') {
    const best = goal.exerciseId ? best1RM(S, goal.exerciseId) : null
    return towardTarget(best ? best.est : 0, goal.target)
  }
  if (goal.type === 'bodyweight') {
    const bw = lastBW(S)
    const start = goal.startValue ?? (bw ? bw.w : goal.target)
    const current = bw ? bw.w : start
    const span = goal.target - start
    const pct = span === 0 ? (current === goal.target ? 1 : 0) : clampPct((current - start) / span)
    return { current, target: goal.target, pct, done: Math.abs(current - goal.target) < 0.05 }
  }
  if (goal.type === 'volume') {
    const from = new Date(goal.createdAt).toISOString().slice(0, 10)
    const count = (S.workouts || []).filter(w => w.d >= from && (!goal.deadline || w.d <= goal.deadline)).length
    return towardTarget(count, goal.target)
  }
  return { current: 0, target: goal.target, pct: 0, done: false }
}
