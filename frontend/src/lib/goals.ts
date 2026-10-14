import { best1RM } from './onerm.ts'
import { lastBW } from './history.js'
import type { AppState, Goal, GoalType } from './state.ts'

/** How far a goal has come: `pct` is 0 to 1, `current` is in the unit the goal's type implies. */
export interface GoalProgress { current: number; target: number; pct: number; done: boolean }

export const GOAL_TYPES: readonly GoalType[] = ['lift', 'bodyweight', 'volume']

// { id, type: 'lift'|'bodyweight'|'volume', exerciseId? (lift only), target, deadline? (ISO
// date), createdAt (ms), startValue? (bodyweight only — the reading at creation time, so
// progress can be a 0-100% bar in either direction, gaining or losing) }
export function addGoal(goals: Goal[] | undefined, goal: Goal): Goal[] { return [...(goals || []), goal] }
export function removeGoal(goals: Goal[] | undefined, id: string): Goal[] { return (goals || []).filter(g => g.id !== id) }
export function updateGoal(goals: Goal[] | undefined, id: string, patch: Partial<Goal>): Goal[] { return (goals || []).map(g => (g.id === id ? { ...g, ...patch } : g)) }

const clampPct = (p: number): number => Math.min(1, Math.max(0, p))
const towardTarget = (current: number, target: number): GoalProgress => ({ current, target, pct: target > 0 ? clampPct(current / target) : 0, done: current >= target })

// { current, target, pct (0-1), done } — current is whatever unit the goal's type implies
// (kg for lift/bodyweight, a workout count for volume). Never throws on a goal that can't be
// evaluated yet (no exerciseId set, no bodyweight logged) — just reads as 0% so far.
export function goalProgress(S: Pick<AppState, 'workouts' | 'bodyweight'>, goal: Goal): GoalProgress {
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
