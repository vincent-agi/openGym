/**
 * The shape of the app's state, `S`, and of the records inside it.
 *
 * `S` is what the store keeps in `localStorage` and what `PUT /api/data` sends to the server verbatim, so these
 * types describe a stored document, not just a runtime object: old profiles lack newer keys (the store overlays
 * what it loads on {@link import('../store/useStore.js').DEF}), and a state read from a file or a backup is
 * *untrusted* until validated. Code that receives such a document types it `unknown` and narrows it; code that
 * works on the store's own state takes {@link AppState}.
 *
 * Dates are ISO `YYYY-MM-DD` strings in the user's calendar, instants are epoch milliseconds.
 * The field-by-field documentation of the stored file is `docs/technical/data-model.md`.
 */

/** Label only: numbers are never converted between units. */
export type Unit = 'kg' | 'lb'
/** Which per-set effort scale is logged. `null` means the profile never chose (see `effortOf`). */
export type EffortKind = 'none' | 'rir' | 'rpe'
export type MobilityLevel = 'full' | 'partial' | 'wheelchair' | 'limited'
/** How an exercise is performed: weight and reps, a duration, or minutes at a speed. */
export type ExerciseMode = 'reps' | 'time' | 'cardio'
export type ProgressionPolicy = 'linear' | 'double' | 'none'
export type PlaylistProvider = 'spotify' | 'youtube' | 'apple' | 'generic'

/** One logged set. The three kinds share one record: weight and reps, a duration, or minutes and speed. */
export interface SetLog {
  w?: number
  r?: number
  done?: boolean
  /** Reps in reserve; a set carries `rir` or `rpe`, never both, and is never rewritten. */
  rir?: number
  rpe?: number
  /** Timed sets. */
  sec?: number
  /** Cardio sets. */
  min?: number
  speed?: number
  /** Which side of a one-sided exercise. */
  side?: 'L' | 'R'
}

/** What a session prescribed for an exercise: a copy of the routine's exercise at the time. */
export interface Prescription {
  sets: number
  reps: number
  weight: number
  [other: string]: unknown
}

/** An exercise inside a finished or running workout. */
export interface Entry {
  /** Catalogue id, or a generated one for a custom exercise. */
  id: string
  /** Superset group id: adjacent entries sharing it are done in turns. */
  sg?: string
  target?: Partial<RoutineExercise> | null
  /** The working weight the user confirmed after the exercise. */
  topW?: number | null
  sets: SetLog[]
  [other: string]: unknown
}

export interface Workout {
  id: string
  d: string
  start: number
  end: number
  routineId: string | null
  name: string
  /** Body weight at the start of the session. */
  bw?: number | null
  /** Total volume, precomputed. */
  vol?: number
  /** Exercise ids that set a record, optionally suffixed `::L` or `::R`. */
  prs?: string[]
  /** How the whole session felt, 1 to 10. */
  sessionRpe?: number
  entries: Entry[]
}

/** The session being recorded; it is local to the device and the server drops it. */
export interface ActiveWorkout {
  id: string
  d: string
  start: number
  routineId: string | null
  name: string
  bw: number | null
  /** Index of the exercise on screen. */
  cur: number
  entries: Entry[]
  lastPressureReliefAt?: number
  [other: string]: unknown
}

export interface RoutineExercise {
  id: string
  sets: number
  reps: number
  weight: number
  mode?: ExerciseMode
  sec?: number
  min?: number
  speed?: number
  bodyweight?: boolean
  side?: boolean
  prog?: ProgressionPolicy
  inc?: number
  repsMin?: number
  repsMax?: number
  sg?: string
}

export interface Playlist { provider: PlaylistProvider; url: string }

export interface Routine {
  id: string
  name: string
  /** Holds an icon key (a literal emoji in older profiles). */
  emoji: string
  prog?: ProgressionPolicy
  playlist?: Playlist
  ex: RoutineExercise[]
}

export interface BodyweightEntry { d: string; w: number; t?: number }

export interface MealEntry {
  id: string
  name: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  ts: number
}
export type NutritionGoal = 'bulk' | 'cut' | 'maintain'
/** Daily targets; `null` means not set, which is not the same as zero. */
export interface NutritionTargets { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }
export interface Nutrition {
  goal: NutritionGoal | null
  targets: NutritionTargets
  /** By ISO date. */
  log: Record<string, MealEntry[]>
  /** Meals planned ahead, same shape as `log`; "mark as eaten" copies one into `log`. */
  mealPlan: Record<string, MealEntry[]>
}

export type MeasurementField = 'waist' | 'chest' | 'arms' | 'hips' | 'bodyFatPct'
/** One day of body measurements; every field is optional (absent means not logged). */
export type Measurement = Partial<Record<MeasurementField, number>>

export type GoalType = 'lift' | 'bodyweight' | 'volume'
export interface Goal {
  id: string
  type: GoalType
  /** Lift goals only. */
  exerciseId?: string
  target: number
  deadline?: string
  createdAt: number
  /** Bodyweight goals only: the reading at creation, so progress is a bar in either direction. */
  startValue?: number
}

/** A planned break, both days included. */
export interface Break { from: string; to: string }

export interface Reminder { on: boolean; time: string; tz: string | null }
export interface PressureRelief { on: boolean; intervalMin: number }

/** A custom exercise the user created; the catalogue's own exercises live in `exercises-data`. */
export interface CustomExercise {
  id: string
  n: string
  bp: string
  desc: string
  tg: string
  eq: string
  custom: true
  [other: string]: unknown
}

export interface AppState {
  /** Epoch ms of the last change; the sync tiebreaker. */
  _ts?: number
  unit: Unit
  restSec: number
  sound: boolean
  keepAwake: boolean
  lang: string
  theme: string
  accent: string
  body: string
  targetW: number | null
  bodyweight: BodyweightEntry[]
  routines: Routine[]
  /** Routine id by day of the week, 0 = Sunday. */
  week: Record<number | string, string | undefined>
  /** Routine id, or `rest`, by ISO date: overrides the weekly plan. */
  dayPlan: Record<string, string | undefined>
  /** Best known working weight per exercise. */
  exWeights: Record<string, { w: number; d: string } | undefined>
  workouts: Workout[]
  active: ActiveWorkout | null
  customEx: CustomExercise[]
  gifSize: string
  playlistCue: boolean
  reminder: Reminder
  effort: EffortKind | null
  nutrition: Nutrition
  /** By ISO date. */
  measurements: Record<string, Measurement | undefined>
  goals: Goal[]
  breaks: Break[]
  /** IANA zone of this device, stamped while friends sharing is on. */
  tz: string | null
  mobilityLevel: MobilityLevel | null
  disabledLimbs: string[]
  preferredPosture: string | null
  /** Tri-state: `null` follows the mobility profile, true and false are explicit choices. */
  largeTouchTargets: boolean | null
  pressureRelief: PressureRelief
}
