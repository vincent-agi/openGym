import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { extractFriendCode, rememberPendingCode, clearPendingCode, addRequestBodies } from '../lib/friends.js'
import { useSocial } from '../lib/useSocial.js'
import { sendFriendRequest } from '../components/FriendSheets.jsx'
import { Button } from '../components/ui.jsx'

/**
 * Landing page of a shared friend link (`#/friend/<code>`).
 *
 * Opening a link never sends anything by itself: a link can be followed by accident, or put in
 * front of someone by a stranger. The person is asked first. Signed-out visitors see the login
 * screen first (the shell renders it for every route), then land here; with sharing off, the
 * code is kept until it is turned on.
 *
 * @returns {JSX.Element}
 */
export default function FriendLink() {
  const nav = useNavigate()
  const { code: raw } = useParams()
  const code = extractFriendCode(raw)
  const { status, social } = useSocial({ probe: true })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (code && status === 'ready' && !social.enabled) rememberPendingCode(code) }, [code, status, social?.enabled])

  const send = async () => {
    setBusy(true)
    try {
      const r = await sendFriendRequest(addRequestBodies(code))
      clearPendingCode()
      setMessage(t('Request sent to {0}', r.friend.displayName))
      setTimeout(() => nav('/crew', { replace: true }), 900)
    } catch (e) { setMessage(e.message); setBusy(false) }
  }

  let body
  if (!code) body = <div className="muted">{t('This friend link is not valid.')}</div>
  else if (status === 'loading') body = <div className="muted">{t('Loading…')}</div>
  else if (status === 'unavailable') body = <div className="muted">{t('Friends are not available here.')}</div>
  else if (!social.enabled) body = <>
    <div className="muted" style={{ marginBottom: 12 }}>{t('Turn on sharing in Settings to accept this invitation. We kept the link for you.')}</div>
    <Button variant="primary" onClick={() => nav('/settings')}>{t('Open Settings')}</Button>
  </>
  else body = <>
    <div style={{ marginBottom: 12 }}>{message || t('Send a friend request using this invitation?')}</div>
    {!message.length && <>
      <Button variant="primary" onClick={send} disabled={busy}>{t('Send request')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => { clearPendingCode(); nav('/crew', { replace: true }) }}>{t('Not now')}</Button>
    </>}
  </>

  return <div className="narrow"><div className="hdr"><div><h1>{t('Friend invitation')}</h1></div></div><div className="card">{body}</div></div>
}
