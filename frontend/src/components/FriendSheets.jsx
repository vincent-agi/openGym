import { useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { friendLink, addRequestBodies } from '../lib/friends.js'
import { Button, TextField } from './ui.jsx'

/**
 * Sends a friend request, trying each candidate body until one is accepted.
 * The server answers every refusal identically, so the message never says why.
 *
 * @param {Array<{code: string} | {handle: string}>} bodies  From {@link addRequestBodies}.
 * @returns {Promise<object>} The accepted answer, `{status, friend}`.
 * @throws {Error} When no candidate worked.
 */
export async function sendFriendRequest(bodies) {
  for (const body of bodies) {
    try { return await api('/api/social/friends/request', { method: 'POST', body: JSON.stringify(body) }) } catch (e) { if (e.status !== 404) throw e }
  }
  throw new Error(t('Nobody can be added with that code or handle.'))
}

/**
 * Bottom sheet to add a friend: share your own code or link, or enter someone else's.
 *
 * @param {object} props
 * @param {() => void} props.close   Closes the sheet.
 * @param {() => void} props.onSent  Called after a request was sent, so the list can refresh.
 * @returns {JSX.Element}
 */
function AddFriendSheet({ close, onSent }) {
  const toast = useUI(s => s.toast)
  const [mine, setMine] = useState(null)   // { code, expiresAt }
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const link = mine ? friendLink(mine.code, location.origin + location.pathname) : ''

  const createCode = async () => {
    setBusy(true)
    try { setMine(await api('/api/social/friends/code', { method: 'POST', body: '{}' })) }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Gymme', text: t('Join me on Gymme'), url: link })
      else { await navigator.clipboard.writeText(link); toast(t('Link copied')) }
    } catch { /* share sheet dismissed */ }
  }
  const send = async () => {
    const bodies = addRequestBodies(input)
    if (!bodies.length) { toast(t('Enter a friend code, a link or @handle')); return }
    setBusy(true)
    try {
      const r = await sendFriendRequest(bodies)
      toast(r.status === 'accepted' ? t('You are now friends with {0}', r.friend.displayName) : t('Request sent to {0}', r.friend.displayName))
      onSent(); close()
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  return <>
    <h3>{t('Add a friend')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Share your code, or enter your friend’s code or @handle.')}</div>

    {mine ? (
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="big" style={{ letterSpacing: '.12em' }}>{mine.code}</div>
        <div className="muted small" style={{ margin: '4px 0 10px' }}>{t('Valid 14 days. Creating a new code cancels this one.')}</div>
        <Button variant="tinted" icon="upload" onClick={share}>{t('Share link')}</Button>
      </div>
    ) : (
      <Button variant="tinted" onClick={createCode} disabled={busy}>{t('Create my friend code')}</Button>
    )}

    <div style={{ height: 16 }} />
    <TextField value={input} autoCapitalize="none" autoCorrect="off" placeholder={t('Code, link or @handle')}
      onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} />
    <div style={{ height: 10 }} />
    <Button variant="primary" onClick={send} disabled={busy || !input.trim()}>{t('Send request')}</Button>
  </>
}

/** Opens the "add a friend" sheet. @param {() => void} onSent Refresh callback. */
export const addFriendSheet = onSent => useUI.getState().openSheet(close => <AddFriendSheet close={close} onSent={onSent} />)
