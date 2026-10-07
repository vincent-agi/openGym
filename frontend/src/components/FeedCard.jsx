import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import { CHEER_EMOJI, cheerLine, timeAgo } from '../lib/cheers.js'
import { useUI } from '../store/useUI.js'

const post = (path, body) => api('/api/social/' + path, { method: 'POST', body: JSON.stringify(body) })

/**
 * Sheet with the five cheers. Tapping the one you already sent takes it back.
 *
 * @param {object} props
 * @param {{id: string, displayName: string, myCheer: string | null}} props.event
 * @param {() => void} props.close
 * @param {() => void} props.onDone  Refreshes the feed.
 */
function CheerSheet({ event, close, onDone }) {
  const toast = useUI(s => s.toast)
  const pick = emoji => {
    const retract = event.myCheer === emoji
    post(retract ? 'cheer/retract' : 'cheer', retract ? { eventId: event.id } : { eventId: event.id, emoji })
      .then(() => { onDone(); close() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3>{t('Cheer {0} on', event.displayName)}</h3>
    <div className="row" style={{ justifyContent: 'space-between', gap: 8, margin: '12px 0' }}>
      {CHEER_EMOJI.map(e => (
        <button key={e} className={'chip' + (event.myCheer === e ? ' on' : '')} aria-label={e} aria-pressed={event.myCheer === e}
          style={{ fontSize: 28, minWidth: 52, minHeight: 52 }} onClick={() => pick(e)}>{e}</button>
      ))}
    </div>
  </>
}

/**
 * Friends' activity: who finished a session, with a cheer button, and the cheers you received on your own.
 *
 * @param {object} props
 * @param {{events: object[], mine: object[]}} props.data  Answer of `GET /api/social/feed`.
 * @param {() => void} props.onChanged
 * @returns {JSX.Element | null}
 */
export default function FeedCard({ data, onChanged }) {
  const openSheet = useUI(s => s.openSheet)
  const now = Date.now()
  const latest = data.mine[0]
  const ago = ms => { const a = timeAgo(ms, now); return t(a.template, a.n) }
  if (!data.events.length && !latest) return null

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('Activity')}</h2>
      {latest && (
        <div className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="lrow-m">
            <span className="lrow-t">{t('Your last session')}</span>
            <span className="lrow-s">{fmtDate(latest.date, true)}</span>
          </span>
          <span style={{ fontSize: 20 }}>{cheerLine(latest.cheers) || <span className="muted small">{t('No cheers yet')}</span>}</span>
        </div>
      )}
      {data.events.map(e => (
        <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 8 }}>
          <span className="lrow-m" style={{ minWidth: 0 }}>
            <span className="lrow-t">{t('{0} finished a session', e.displayName)}</span>
            <span className="lrow-s">{ago(e.createdAt)}{e.cheers.length ? ' · ' + cheerLine(e.cheers) : ''}</span>
          </span>
          <button className="chip" style={{ minWidth: 48, minHeight: 40, fontSize: 20 }} aria-label={t('Cheer {0} on', e.displayName)}
            onClick={() => openSheet(close => <CheerSheet event={e} close={close} onDone={onChanged} />)}>{e.myCheer || '👏'}</button>
        </div>
      ))}
    </div>
  )
}
