import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { useStore } from '../store/useStore.js'
import { DEMO } from './demo.js'
import { MOBILE } from './mobile.js'
import { newBadges, badgeInfo } from './badges.js'

/**
 * Whether the friends module is usable here, and the signed-in user's sharing settings.
 *
 * Asks the server once on mount. `status` is `'loading'` until it answers, then one of:
 * - `'unavailable'`: guest, demo/mobile build, or the instance switched the module off;
 * - `'ready'`: the module is on and `social` holds the user's settings (`social.enabled` says whether they opted in).
 *
 * @returns {{status: 'loading'|'unavailable'|'ready', social: import('./social.js').SocialSettings | null, reload: () => void}}
 */
export function useSocial() {
  const user = useStore(s => s.user)
  const usable = (!!user || DEMO) && !MOBILE   // the demo is answered with made-up data (lib/demoSocial.js)
  const [state, setState] = useState({ status: usable ? 'loading' : 'unavailable', social: null })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(n => n + 1), [])

  useEffect(() => {
    if (!usable) { setState({ status: 'unavailable', social: null }); return undefined }
    let live = true
    api('/api/config')
      .then(c => (c.social_enabled ? api('/api/social/me') : null))
      .then(r => { if (live) setState(r ? { status: 'ready', social: r.social } : { status: 'unavailable', social: null }) })
      .catch(() => { if (live) setState({ status: 'unavailable', social: null }) })
    return () => { live = false }
  }, [usable, tick])

  return { ...state, reload }
}

/**
 * Loads the friends' shared summaries (the Crew leaderboard data) and keeps them fresh.
 * Reloads when the tab regains focus. A failure keeps the last good data and reports `error`.
 *
 * @param {boolean} enabled  Only fetch when the user is allowed to (sharing on).
 * @returns {{data: {me: object, friends: object[]} | null, error: string, reload: () => void}}
 */
export function useCrewSummary(enabled) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const reload = useCallback(() => {
    api('/api/social/friends/summary').then(d => { setData(d); setError('') }).catch(e => setError(e.message))
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [enabled, reload])

  return { data, error, reload }
}

/**
 * Loads the friends' activity feed and the caller's own recent sessions with the cheers they received.
 * Reloads when the tab regains focus.
 *
 * @param {boolean} enabled
 * @returns {{data: {events: object[], mine: object[]} | null, reload: () => void}}
 */
export function useFeed(enabled) {
  const [data, setData] = useState(null)
  const reload = useCallback(() => { api('/api/social/feed').then(setData).catch(() => {}) }, [])
  useEffect(() => {
    if (!enabled) return undefined
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [enabled, reload])
  return { data, reload }
}

/**
 * The caller's challenges, for places that only need a glance (the weekly recap).
 *
 * @param {boolean} enabled
 * @returns {object[] | null}  Challenge views, null until loaded.
 */
export function useChallenges(enabled) {
  const [list, setList] = useState(null)
  useEffect(() => {
    if (!enabled) return
    api('/api/social/challenges').then(r => setList(r.challenges)).catch(() => {})
  }, [enabled])
  return list
}

const SEEN_KEY = 'gymme_seen_badges'

/**
 * Celebrates badges earned since the last visit with a toast. The first visit only records what
 * is already earned, so nobody is greeted by a pile of old news.
 *
 * @param {Array<{id: string, date: string}> | undefined} earned  From the user's social settings.
 * @param {(message: string) => void} toast
 * @param {(key: string, ...args: any[]) => string} translate  `t` from the i18n module.
 */
export function useBadgeToasts(earned, toast, translate) {
  useEffect(() => {
    if (!earned) return
    let seen = null
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)) } catch { /* private mode: treat as first visit */ }
    const fresh = seen === null ? [] : newBadges(earned, seen)
    fresh.forEach(b => toast(translate('New badge: {0}', translate(badgeInfo(b.id).name))))
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(earned.map(b => b.id))) } catch { /* ignore */ }
  }, [earned, toast, translate])
}
