import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { RECAP_DISMISS_KEY } from '../lib/recap.js'
import { Button } from './ui.jsx'

/**
 * The Monday recap: your week against your plan, your streak, a challenge, and what the crew did.
 * Without sharing it keeps to personal figures and softly mentions friends.
 *
 * @param {object} props
 * @param {object} props.recap  From `buildRecap`.
 * @param {() => void} props.onOpenFriends  Where the soft invitation leads.
 * @param {boolean} props.sharing
 * @returns {JSX.Element | null}
 */
export default function RecapCard({ recap, sharing, onOpenFriends }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null

  const dismiss = value => {
    try { localStorage.setItem(RECAP_DISMISS_KEY, value) } catch { /* ignore: it will simply show again */ }
    setHidden(true)
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('Your week')}</h2>
      <div style={{ fontSize: 22, fontWeight: 600 }}>
        {recap.sessions}{recap.planned ? ' / ' + recap.planned : ''} <span className="muted" style={{ fontSize: '1rem' }}>{t('sessions last week')}</span>
      </div>
      <div className="muted small" style={{ margin: '4px 0 8px' }}>
        {t('{0} week streak', recap.streak)}
        {recap.challenge ? ' · ' + t('{0}: {1}%', recap.challenge.title, Math.round(recap.challenge.pct * 100)) : ''}
        {recap.crewSessions != null ? ' · ' + t('Your crew trained {0} times this week so far', recap.crewSessions) : ''}
      </div>
      <div style={{ marginBottom: 10 }}>{t(recap.line)}</div>
      {!sharing && (
        <div className="row between" style={{ marginBottom: 10, gap: 8 }}>
          <span className="muted small">{t('Training is better with friends.')}</span>
          <Button size="sm" variant="tinted" onClick={onOpenFriends}>{t('Set up Crew')}</Button>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" onClick={() => dismiss(recap.weekStart)}>{t('Dismiss')}</Button>
        <Button size="sm" variant="ghost" className="dim" onClick={() => dismiss('never')}>{t('Don’t show again')}</Button>
      </div>
    </div>
  )
}
