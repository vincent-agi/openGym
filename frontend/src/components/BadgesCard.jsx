import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { CATALOG } from '../lib/badges.js'
import { useUI } from '../store/useUI.js'
import { Switch } from './ui.jsx'

/**
 * Your badges: the ones earned (with the day), the ones still to come, and a switch per earned
 * badge to let friends see it. Friends see none until you choose.
 *
 * @param {object} props
 * @param {Array<{id: string, date: string}>} props.earned
 * @param {string[]} props.shown  Ids friends may see.
 * @param {(social: object) => void} props.onSaved  Receives the updated settings.
 * @returns {JSX.Element}
 */
export default function BadgesCard({ earned, shown, onSaved }) {
  const toast = useUI(s => s.toast)
  const dateOf = id => earned.find(b => b.id === id)?.date

  const toggle = (id, on) => {
    const next = on ? [...shown, id] : shown.filter(x => x !== id)
    api('/api/social/me', { method: 'PUT', body: JSON.stringify({ showBadges: next }) })
      .then(r => onSaved(r.social)).catch(e => toast(e.message))
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('Your badges')}</h2>
      <div className="muted small" style={{ marginBottom: 6 }}>{t('Rewards for showing up. Friends only see the ones you choose.')}</div>
      {CATALOG.map(b => {
        const got = dateOf(b.id)
        return (
          <div key={b.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 8, opacity: got ? 1 : 0.5 }}>
            <span className="lrow-m" style={{ minWidth: 0 }}>
              <span className="lrow-t">{t(b.name)}</span>
              <span className="lrow-s">{got ? fmtDate(got, true) + ' · ' : ''}{t(b.description)}</span>
            </span>
            {got && <Switch checked={shown.includes(b.id)} onChange={on => toggle(b.id, on)} />}
          </div>
        )
      })}
    </div>
  )
}
