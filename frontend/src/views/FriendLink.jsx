import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { extractFriendCode, rememberPendingCode, addRequestBodies } from '../lib/friends.js'
import { useSocial } from '../lib/useSocial.js'
import { sendFriendRequest } from '../components/FriendSheets.jsx'
import { Button } from '../components/ui.jsx'

/**
 * Landing page of a shared friend link (`#/friend/<code>`).
 * Signed-out visitors see the login screen first (the shell renders it for every route), then
 * land here. With sharing on the request is sent at once; otherwise the code is kept until
 * sharing is enabled and redeemed from the Crew screen.
 *
 * @returns {JSX.Element}
 */
export default function FriendLink() {
  const nav = useNavigate()
  const { code: raw } = useParams()
  const code = extractFriendCode(raw)
  const { status, social } = useSocial()
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!code || status !== 'ready' || !social.enabled) return
    sendFriendRequest(addRequestBodies(code))
      .then(r => { setMessage(t('Request sent to {0}', r.friend.displayName)); setTimeout(() => nav('/crew', { replace: true }), 900) })
      .catch(e => setMessage(e.message))
  }, [code, status, social?.enabled, nav])

  useEffect(() => { if (code && status === 'ready' && !social.enabled) rememberPendingCode(code) }, [code, status, social?.enabled])

  let body
  if (!code) body = <div className="muted">{t('This friend link is not valid.')}</div>
  else if (status === 'loading') body = <div className="muted">{t('Loading…')}</div>
  else if (status === 'unavailable') body = <div className="muted">{t('Friends are not available here.')}</div>
  else if (!social.enabled) body = <>
    <div className="muted" style={{ marginBottom: 12 }}>{t('Turn on sharing in Settings to accept this invitation. We kept the link for you.')}</div>
    <Button variant="primary" onClick={() => nav('/settings')}>{t('Open Settings')}</Button>
  </>
  else body = <div className="muted">{message || t('Sending request…')}</div>

  return <div className="narrow"><div className="hdr"><div><h1>{t('Friend invitation')}</h1></div></div><div className="card">{body}</div></div>
}
