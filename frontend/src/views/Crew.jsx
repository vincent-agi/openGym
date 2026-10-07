import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { peekPendingCode, clearPendingCode, addRequestBodies } from '../lib/friends.js'
import { useSocial, useCrewSummary, useFeed, useBadgeToasts } from '../lib/useSocial.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'
import { addFriendSheet, sendFriendRequest } from '../components/FriendSheets.jsx'
import { Button } from '../components/ui.jsx'
import CrewBoard from '../components/CrewBoard.jsx'
import ChallengesCard from '../components/ChallengesCard.jsx'
import FeedCard from '../components/FeedCard.jsx'
import BadgesCard from '../components/BadgesCard.jsx'

const post = (path, body) => api('/api/social/friends/' + path, { method: 'POST', body: JSON.stringify(body) })

/** One person in a list: name, handle and trailing actions. */
function PersonRow({ person, subtitle, children }) {
  return (
    <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', gap: 8 }}>
      <span className="lrow-m" style={{ minWidth: 0 }}>
        <span className="lrow-t">{person.displayName || '@' + person.handle}</span>
        <span className="lrow-s">{subtitle || '@' + person.handle}</span>
      </span>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</span>
    </div>
  )
}

/**
 * Crew screen: your friends, the requests waiting for you and the people you blocked.
 *
 * @returns {JSX.Element}
 */
export default function Crew() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const { status, social, reload: reloadSocial } = useSocial({ probe: true })
  const [invite, setInvite] = useState(() => peekPendingCode())   // a friend link opened before sharing was on
  useBadgeToasts(social?.enabled ? social.earned : undefined, toast, t)
  const [data, setData] = useState(null)
  const board = useCrewSummary(status === 'ready' && !!social?.enabled)
  const feed = useFeed(status === 'ready' && !!social?.enabled)

  const load = useCallback(() => api('/api/social/friends').then(setData).catch(e => toast(e.message)), [toast])

  useEffect(() => {
    if (status === 'ready' && social.enabled) load()
  }, [status, social?.enabled, load])

  useEffect(() => { if (board.error) toast(board.error) }, [board.error, toast])

  const answerInvite = send => {
    const code = invite
    clearPendingCode(); setInvite(null)
    if (send) sendFriendRequest(addRequestBodies(code)).then(r => { toast(t('Request sent to {0}', r.friend.displayName)); load() }).catch(e => toast(e.message))
  }

  const act = (path, body, message) => post(path, body).then(() => { if (message) toast(message); load() }).catch(e => toast(e.message))

  const removeFriend = f => confirmSheet({
    title: t('Remove friend'), message: t('Remove {0} from your friends? You can add them again later.', f.displayName),
    confirmText: t('Remove friend'), cancelText: t('Keep'),
    onConfirm: () => act('remove', { handle: f.handle }, t('Friend removed'))
  })
  /** Hides (or shows again) the cheers a friend sends you. They are not told. */
  const toggleMute = f => {
    const muted = !(feed.data?.muted || []).includes(f.handle)
    api('/api/social/cheer/mute', { method: 'POST', body: JSON.stringify({ handle: f.handle, muted }) }).then(() => { toast(muted ? t('Cheers muted') : t('Cheers shown again')); feed.reload() }).catch(e => toast(e.message))
  }
  const blockMenu = f => confirmSheet({
    title: t('Block {0}?', f.displayName), danger: true, confirmText: t('Block'),
    message: t('They will not be told. They can no longer find you or send requests.'),
    onConfirm: () => act('block', { handle: f.handle }, t('Blocked'))
  })

  let body
  if (status === 'loading') body = <div className="muted">{t('Loading…')}</div>
  else if (status === 'unavailable') body = <div className="card muted">{t('Friends are not available here.')}</div>
  else if (!social.enabled) body = (
    <div className="card">
      <div className="muted" style={{ marginBottom: 12 }}>{t('Turn on sharing to add friends. You choose exactly what they see.')}</div>
      <Button variant="primary" onClick={() => nav('/settings')}>{t('Open Settings')}</Button>
    </div>
  )
  else if (!data) body = <div className="muted">{t('Loading…')}</div>
  else body = <>
    {invite && (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('Friend invitation')}</h2>
        <div style={{ marginBottom: 10 }}>{t('Send a friend request using this invitation?')}</div>
        <div className="row" style={{ gap: 8 }}>
          <Button variant="primary" size="sm" onClick={() => answerInvite(true)}>{t('Send request')}</Button>
          <Button size="sm" onClick={() => answerInvite(false)}>{t('Not now')}</Button>
        </div>
      </div>
    )}
    {board.data && <CrewBoard data={board.data} hideRank={!!social.hideRank} onRefresh={board.reload} onAdd={() => addFriendSheet(() => { load(); board.reload() })} />}

    {feed.data && <FeedCard data={feed.data} onChanged={feed.reload} />}

    {board.data && <ChallengesCard myHandle={social.handle} friends={data.friends} />}

    {data.incoming.length > 0 && (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('Requests')}</h2>
        {data.incoming.map(p => (
          <PersonRow key={p.handle} person={p}>
            <Button size="sm" variant="primary" onClick={() => act('respond', { handle: p.handle, action: 'accept' }, t('You are now friends with {0}', p.displayName))}>{t('Accept')}</Button>
            <Button size="sm" onClick={() => act('respond', { handle: p.handle, action: 'decline' })}>{t('Decline')}</Button>
          </PersonRow>
        ))}
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Friends')}</h2>
        <Button size="sm" icon="plus" onClick={() => addFriendSheet(load)}>{t('Add')}</Button>
      </div>
      {data.friends.length ? data.friends.map(f => (
        <PersonRow key={f.handle} person={f} subtitle={t('Friends since {0}', fmtDate(isoOf(new Date(f.since)), true))}>
          <Button size="sm" onClick={() => toggleMute(f)}>{(feed.data?.muted || []).includes(f.handle) ? t('Unmute cheers') : t('Mute cheers')}</Button>
          <Button size="sm" onClick={() => removeFriend(f)}>{t('Remove')}</Button>
          <Button size="sm" onClick={() => blockMenu(f)}>{t('Block')}</Button>
        </PersonRow>
      )) : <div className="muted small">{t('No friends yet. Share your code or enter a friend’s.')}</div>}
    </div>

    <BadgesCard earned={social.earned || []} shown={social.showBadges || []} onSaved={reloadSocial} />

    {data.outgoing.length > 0 && (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('Waiting for an answer')}</h2>
        {data.outgoing.map(p => <PersonRow key={p.handle} person={p} />)}
      </div>
    )}

    {data.blocked.length > 0 && (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{t('Blocked')}</h2>
        {data.blocked.map(p => (
          <PersonRow key={p.handle} person={p}>
            <Button size="sm" onClick={() => act('unblock', { handle: p.handle }, t('Unblocked'))}>{t('Unblock')}</Button>
          </PersonRow>
        ))}
      </div>
    )}
  </>

  return (
    <div className="narrow">
      <div className="hdr"><div><h1>{t('Crew')}</h1><div className="sub">{t('Train together, cheer each other on.')}</div></div></div>
      {body}
    </div>
  )
}
