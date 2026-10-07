import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { PERIODS, metricsFor, rankCrew } from '../lib/crew.js'
import { Segmented, Button } from './ui.jsx'

const PERIOD_LABEL = { week: 'Week', month: 'Month' }
const METRIC_LABEL = { consistency: 'Consistency', sessions: 'Sessions', streak: 'Streak' }

/** Neutral wording for people without a number: never "last", never "0". */
const STATUS_TEXT = {
  idle: p => (p === 'month' ? 'No session yet this month' : 'No session yet this week'),
  noplan: () => 'Nothing planned this week',
  stale: () => 'Not active recently',
  pending: () => 'Waiting for their first sync',
  private: () => 'Not shared'
}

/**
 * The text shown for a leaderboard value.
 *
 * @param {number} value
 * @param {'consistency'|'sessions'|'streak'} metric
 * @returns {string}
 */
export function formatValue(value, metric) {
  if (metric === 'consistency') return Math.round(value * 100) + '%'
  return String(value)
}

/**
 * Friendly leaderboard of the crew: a Week | Month switch, a sort selector, one row per person.
 *
 * @param {object} props
 * @param {{me: object, friends: object[]}} props.data  Answer of `GET /api/social/friends/summary`.
 * @param {boolean} props.hideRank   The viewer opted out of rankings (cheer-only mode).
 * @param {() => void} props.onRefresh
 * @param {() => void} props.onAdd   Opens the add-a-friend sheet.
 * @returns {JSX.Element}
 */
export default function CrewBoard({ data, hideRank, onRefresh, onAdd }) {
  const [period, setPeriod] = useState('week')
  const [metric, setMetric] = useState('consistency')

  // Consistency has no monthly figure: switching to Month falls back to sessions.
  const metrics = metricsFor(period)
  const active = metrics.includes(metric) ? metric : 'sessions'
  const rows = rankCrew(data.me, data.friends, { metric: active, period, viewerHidesRank: hideRank })

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{t('This crew')}</h2>
        <Button size="sm" onClick={onRefresh}>{t('Refresh')}</Button>
      </div>
      <Segmented options={PERIODS.map(p => ({ value: p, label: t(PERIOD_LABEL[p]) }))} value={period} onChange={setPeriod} />
      <div style={{ height: 8 }} />
      <Segmented options={metrics.map(m => ({ value: m, label: t(METRIC_LABEL[m]) }))} value={active} onChange={setMetric} />
      <div style={{ height: 8 }} />

      {data.friends.length === 0 && (
        <div style={{ margin: '8px 0 12px' }}>
          <div className="muted small" style={{ marginBottom: 10 }}>{t('Your friends will appear here once they accept your request.')}</div>
          <Button variant="tinted" icon="plus" onClick={onAdd}>{t('Add a friend')}</Button>
        </div>
      )}

      {rows.map(r => (
        <div key={r.handle} className="row between"
          style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', gap: 8, fontWeight: r.isMe ? 600 : 400, background: r.isMe ? 'var(--surface-2)' : undefined }}>
          <span className="row" style={{ gap: 10, minWidth: 0 }}>
            <span style={{ width: 22, textAlign: 'center', color: 'var(--label-3)' }}>{r.position ?? ''}</span>
            <span className="lrow-m" style={{ minWidth: 0 }}>
              <span className="lrow-t">{r.displayName}{r.isMe ? ' · ' + t('you') : ''}</span>
              {STATUS_TEXT[r.status] && <span className="lrow-s">{t(STATUS_TEXT[r.status](period))}</span>}
            </span>
          </span>
          {r.value != null && STATUS_TEXT[r.status] === undefined && <span>{formatValue(r.value, active)}</span>}
        </div>
      ))}
    </div>
  )
}
