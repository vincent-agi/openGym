// Friendly challenges — client-side helpers: ready-made templates and display rules.
// The server validates and owns everything that matters (see api/challenges.js).

import { T } from './i18n.js'

const DAY_MS = 86400000

/**
 * Adds days to an ISO date without touching the local time zone.
 *
 * @param {string} iso   `YYYY-MM-DD`.
 * @param {number} days  May be negative.
 * @returns {string}
 */
export function addDaysIso(iso, days) {
  return new Date(Date.parse(iso + 'T12:00:00Z') + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * A ready-made challenge, so nobody has to design one from scratch.
 *
 * @typedef {object} Template
 * @property {string} key
 * @property {string} title     Shown, and used as the default challenge name.
 * @property {'sessions'|'activeDays'|'streak'|'consistency'} type
 * @property {'versus'|'coop'} mode
 * @property {number} target
 * @property {number} days      Length, in days.
 */

/** @type {Template[]} */
export const TEMPLATES = [
  { key: 'plan-4w', title: T('Stick to the plan'), type: 'consistency', mode: 'versus', target: 3, days: 28 },
  { key: 'sessions-4w', title: T('4 weeks · 12 sessions'), type: 'sessions', mode: 'versus', target: 12, days: 28 },
  { key: 'streak-4w', title: T('4 weeks in a row'), type: 'streak', mode: 'versus', target: 4, days: 28 },
  { key: 'coop-30', title: T('Co-op · 30 sessions together'), type: 'sessions', mode: 'coop', target: 30, days: 28 }
]

/**
 * Turns a template into the fields the create form starts from.
 *
 * @param {Template} template
 * @param {string} today  ISO date the challenge starts on.
 * @returns {{title: string, type: string, mode: string, target: number, startDate: string, endDate: string}}
 */
export function buildDraft(template, today) {
  const { title, type, mode, target, days } = template
  return { title, type, mode, target, startDate: today, endDate: addDaysIso(today, days - 1) }
}

/**
 * One sentence on why a challenge type is fair, shown when creating it.
 * Keyed by challenge type; ready for `t()`.
 */
export const FAIRNESS = {
  consistency: T('Fair for everyone: it counts the weeks you do the sessions you planned, whatever your level.'),
  sessions: T('Counts sessions, not weight or size, so anyone can win.'),
  activeDays: T('Counts the days you trained, not how hard.'),
  streak: T('Counts weeks in a row with a session: showing up is what matters.')
}

const UNITS = { sessions: T('sessions'), activeDays: T('active days'), streak: T('weeks in a row'), consistency: T('weeks on plan') }

/**
 * What a challenge counts, as a plural phrase ready for `t()`.
 *
 * @param {'sessions'|'activeDays'|'streak'|'consistency'} type
 * @returns {string}
 */
export const unitLabel = type => UNITS[type]

/**
 * The bar shown for a challenge: your own count in a versus challenge, the crew's total in co-op.
 *
 * @param {object} view   Challenge view returned by the API.
 * @param {string} myHandle
 * @returns {{current: number, target: number, pct: number, unit: string}}
 */
export function progressLine(view, myHandle) {
  const unit = unitLabel(view.type)
  if (view.mode === 'coop') return { current: view.total, target: view.target, pct: view.pct, unit }
  const mine = view.participants.find(p => p.handle === myHandle)
  const current = mine?.current ?? 0
  return { current, target: view.target, pct: Math.min(1, current / view.target), unit }
}

/**
 * Sorts a list of challenge views into what the person has to answer, what is running and what is over.
 *
 * @param {object[]} list
 * @param {string} myHandle
 * @returns {{invited: object[], running: object[], past: object[]}}
 */
export function groupChallenges(list, myHandle) {
  const out = { invited: [], running: [], past: [] }
  for (const c of list) {
    const state = c.participants.find(p => p.handle === myHandle)?.state
    if (c.status === 'ended' || c.status === 'cancelled') out.past.push(c)
    else if (state === 'invited') out.invited.push(c)
    else out.running.push(c)
  }
  return out
}
