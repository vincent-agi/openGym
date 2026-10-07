// Demo build: a believable crew without a server.
//
// The GitHub Pages demo has no API, so the friends module would be invisible there. This answers
// the module's read-only requests with made-up people (who exist nowhere) so a visitor can see
// the Crew screen, the leaderboard, a co-op challenge, the feed and badges. Everything that would
// change something is refused with a friendly message: a crew needs a server.
//
// Only imported behind `DEMO` (see lib/api.js): a separate lazy chunk that self-hosted builds never load,
// like the demo seed.

import { addDaysIso } from './challenges.js'
import { weekStartOf } from './recap.js'

/** Handle of the demo visitor. */
export const DEMO_ME_HANDLE = 'you'

const DEMO_ERROR = 'This is a demo: friends need a server. Self-host Gymme to try it with your own crew.'

const isoOf = ms => new Date(ms).toISOString().slice(0, 10)

/** Builds the people and what they did this week, relative to `now`. */
function crew(now) {
  const today = isoOf(now)
  const monday = weekStartOf(today)
  // Days of this week that are not in the future.
  const daysSoFar = Array.from({ length: 7 }, (_, i) => addDaysIso(monday, i)).filter(d => d <= today)
  const active = (n, extra = []) => [...extra, ...daysSoFar.slice(0, n)].filter((d, i, a) => a.indexOf(d) === i).sort()

  const person = (handle, displayName, o) => ({
    handle, displayName, hideRank: false, stale: false, updatedAt: now - 3600000,
    badges: o.badges || [],
    summary: {
      weekSessions: o.week, monthSessions: o.month, activeDays: active(o.week, o.earlier || []), lastActiveDate: active(o.week, o.earlier || []).pop() || null,
      weekPlanned: o.planned, weekConsistency: o.planned ? Math.min(1, Math.round((o.week / o.planned) * 100) / 100) : null,
      weeklyTrend: o.trend, streakWeeks: o.streak
    }
  })

  return {
    me: person(DEMO_ME_HANDLE, 'Alex', { week: 2, month: 7, planned: 3, trend: 0.8, streak: 4, earlier: [addDaysIso(monday, -3)] }),
    friends: [
      person('lea_fit', 'Léa', { week: 3, month: 11, planned: 3, trend: 1.2, streak: 6, badges: [{ id: 'four-in-a-row', date: addDaysIso(today, -20) }] }),
      person('marc_92', 'Marc', { week: 2, month: 8, planned: 3, trend: 0.5, streak: 3 }),
      person('zoe_runs', 'Zoe', { week: 1, month: 5, planned: 2, trend: 0.2, streak: 2 })
    ],
    today, monday
  }
}

/**
 * Answers a request to the friends module with demo data.
 *
 * @param {string} path  Request path, with its query string.
 * @param {{method?: string} | undefined} opts  As passed to `fetch`.
 * @param {number} [now]  Epoch ms, injectable for tests.
 * @returns {object} The same shape the real API returns.
 * @throws {Error} For anything that would change data, or a route the demo does not have.
 */
export function demoSocialApi(path, opts, now = Date.now()) {
  if ((opts?.method || 'GET') !== 'GET') throw new Error(DEMO_ERROR)
  const [route] = path.split('?')
  const { me, friends, today, monday } = crew(now)

  switch (route) {
    case '/api/config':
      return { invite_only: false, social_enabled: true }

    case '/api/social/me':
      return {
        social: {
          enabled: true, handle: DEMO_ME_HANDLE, displayName: 'Alex', hideRank: false,
          share: { sessions: true, streak: true, consistency: true, prs: false },
          notify: { friendSession: false, cheerReceived: false, challengeInvite: false, challengeMilestone: false, challengeEnded: false, quiet: { from: '21:00', to: '08:00' } },
          showBadges: ['hat-trick'],
          earned: [{ id: 'first-week', date: addDaysIso(today, -60) }, { id: 'hat-trick', date: addDaysIso(today, -30) }]
        }
      }

    case '/api/social/friends':
      return {
        friends: friends.map((f, i) => ({ handle: f.handle, displayName: f.displayName, since: now - (i + 2) * 7 * 86400000 })),
        incoming: [], outgoing: [], blocked: []
      }

    case '/api/social/friends/summary':
      return { me, friends }

    case '/api/social/feed':
      return {
        events: [
          { id: 'demo-e1', handle: 'lea_fit', displayName: 'Léa', date: today, createdAt: now - 2 * 3600000, cheers: [{ emoji: '🔥', count: 1 }], myCheer: null },
          { id: 'demo-e2', handle: 'marc_92', displayName: 'Marc', date: today, createdAt: now - 20 * 3600000, cheers: [{ emoji: '👏', count: 2 }], myCheer: '👏' }
        ],
        mine: [{
          id: 'demo-m1', date: addDaysIso(today, -1), createdAt: now - 26 * 3600000,
          cheers: [{ emoji: '👏', count: 1 }, { emoji: '🔥', count: 2 }],
          from: [{ emoji: '👏', displayName: 'Léa' }, { emoji: '🔥', displayName: 'Marc' }, { emoji: '🔥', displayName: 'Zoe' }]
        }]
      }

    case '/api/social/challenges':
    case '/api/social/challenge': {
      const challenge = {
        id: 'demo-coop', title: 'Autumn together', type: 'sessions', mode: 'coop', target: 30,
        startDate: addDaysIso(monday, -14), endDate: addDaysIso(monday, 13), status: 'active', total: 18, pct: 0.6, done: false,
        participants: [
          { handle: 'lea_fit', displayName: 'Léa', state: 'joined', current: 7, pct: 7 / 30, position: null },
          { handle: DEMO_ME_HANDLE, displayName: 'Alex', state: 'joined', current: 6, pct: 0.2, position: null },
          { handle: 'marc_92', displayName: 'Marc', state: 'joined', current: 5, pct: 5 / 30, position: null },
          { handle: 'zoe_runs', displayName: 'Zoe', state: 'invited', current: null, pct: null, position: null }
        ]
      }
      return route.endsWith('s') ? { challenges: [challenge] } : { challenge }
    }

    default:
      throw new Error(DEMO_ERROR)
  }
}
