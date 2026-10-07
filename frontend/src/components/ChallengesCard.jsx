import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { TEMPLATES, buildDraft, unitLabel, progressLine, groupChallenges } from '../lib/challenges.js'
import { useUI } from '../store/useUI.js'
import { Button, Segmented, TextField } from './ui.jsx'

const post = (path, body) => api('/api/social/challenges' + path, { method: 'POST', body: JSON.stringify(body) })

/** A thin progress bar. @param {{pct: number}} props */
function Bar({ pct }) {
  return (
    <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)', margin: '6px 0' }}>
      <div style={{ height: '100%', borderRadius: 3, width: Math.round(pct * 100) + '%', background: 'var(--acc)', transition: 'width .2s' }} />
    </div>
  )
}

/**
 * Sheet that shows one challenge: progress, everyone's standing, and the actions you can take.
 *
 * @param {object} props
 * @param {object} props.challenge  Challenge view from the API.
 * @param {string} props.myHandle
 * @param {() => void} props.close
 * @param {() => void} props.onChanged  Refreshes the list after leaving or cancelling.
 */
function ChallengeDetail({ challenge: c, myHandle, close, onChanged }) {
  const toast = useUI(s => s.toast)
  const line = progressLine(c, myHandle)
  const live = c.status === 'upcoming' || c.status === 'active'
  const me = c.participants.find(p => p.handle === myHandle)
  const run = (path, msg) => post(path, { id: c.id }).then(() => { toast(msg); onChanged(); close() }).catch(e => toast(e.message))
  const STATE_TEXT = { invited: 'Invited', paused: 'Paused', left: 'Left' }

  return <>
    <h3>{c.title}</h3>
    <div className="muted small">{fmtDate(c.startDate, true)} → {fmtDate(c.endDate, true)} · {c.mode === 'coop' ? t('Together') : t('Friendly duel')}</div>
    <Bar pct={line.pct} />
    <div className="small" style={{ marginBottom: 10 }}>
      {line.current} / {line.target} {t(line.unit)}
      {c.done && <b> · {t('Done together. Well played!')}</b>}
      {c.status === 'ended' && !c.done && c.mode === 'coop' && <span className="muted"> · {t('Finished')}</span>}
    </div>
    {c.participants.map(p => (
      <div key={p.handle} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', fontWeight: p.handle === myHandle ? 600 : 400 }}>
        <span>{p.position ? p.position + '. ' : ''}{p.displayName}{p.state in STATE_TEXT ? <span className="muted"> · {t(STATE_TEXT[p.state])}</span> : null}</span>
        {p.current != null && <span>{p.current}</span>}
      </div>
    ))}
    <div style={{ height: 14 }} />
    {live && me?.state === 'invited' && <Button variant="primary" onClick={() => run('/join', t('You joined the challenge'))}>{t('Join')}</Button>}
    {live && me?.state === 'left' && <Button variant="tinted" onClick={() => run('/join', t('You joined the challenge'))}>{t('Rejoin')}</Button>}
    {live && (me?.state === 'joined' || me?.state === 'invited') && <>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => run('/leave', t('You left the challenge'))}>{me.state === 'invited' ? t('Decline') : t('Leave challenge')}</Button>
    </>}
  </>
}

/**
 * Sheet to start a challenge: pick a template, tweak it, choose who to invite.
 *
 * @param {object} props
 * @param {Array<{handle: string, displayName: string}>} props.friends  Friends who can be invited.
 * @param {() => void} props.close
 * @param {() => void} props.onCreated
 */
function NewChallenge({ friends, close, onCreated }) {
  const toast = useUI(s => s.toast)
  const today = todayISO()
  const [draft, setDraft] = useState(() => buildDraft(TEMPLATES[0], today))
  const [invite, setInvite] = useState([])
  const [busy, setBusy] = useState(false)
  const set = patch => setDraft(d => ({ ...d, ...patch }))
  const toggle = h => setInvite(list => (list.includes(h) ? list.filter(x => x !== h) : [...list, h]))

  const create = async () => {
    setBusy(true)
    try { await post('', { ...draft, target: Number(draft.target), invite }); toast(t('Challenge created')); onCreated(); close() }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  return <>
    <h3>{t('New challenge')}</h3>
    <div className="chips" style={{ marginBottom: 12 }}>
      {TEMPLATES.map(tpl => (
        <button key={tpl.key} className={'chip' + (draft.title === tpl.title ? ' on' : '')} onClick={() => setDraft(buildDraft(tpl, today))}>{t(tpl.title)}</button>
      ))}
    </div>
    <TextField value={draft.title} maxLength={40} onChange={e => set({ title: e.target.value })} />
    <div style={{ height: 8 }} />
    <Segmented options={[{ value: 'versus', label: t('Friendly duel') }, { value: 'coop', label: t('Together') }]} value={draft.mode} onChange={mode => set({ mode })} />
    <div className="muted small" style={{ margin: '6px 2px 10px' }}>
      {draft.mode === 'coop' ? t('Everyone’s progress adds up to one shared target.') : t('Everyone chases the same target. Ties are fine.')}
    </div>
    <div className="row" style={{ gap: 8 }}>
      <TextField type="number" inputMode="numeric" min="1" value={draft.target} onChange={e => set({ target: e.target.value })} />
      <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{t(unitLabel(draft.type))}</span>
    </div>
    <div style={{ height: 8 }} />
    <div className="row" style={{ gap: 8 }}>
      <TextField type="date" min={today} value={draft.startDate} onChange={e => set({ startDate: e.target.value })} />
      <TextField type="date" min={draft.startDate} value={draft.endDate} onChange={e => set({ endDate: e.target.value })} />
    </div>
    <div className="muted small" style={{ margin: '12px 2px 6px' }}>{t('Invite friends')}</div>
    {friends.length ? friends.map(f => (
      <button key={f.handle} className="lrow tap" onClick={() => toggle(f.handle)} aria-pressed={invite.includes(f.handle)}>
        <span className="lrow-m"><span className="lrow-t">{f.displayName}</span><span className="lrow-s">@{f.handle}</span></span>
        {invite.includes(f.handle) && <span className="lrow-k">✓</span>}
      </button>
    )) : <div className="muted small">{t('Add a friend first.')}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={create} disabled={busy || !invite.length || !draft.title.trim()}>{t('Create challenge')}</Button>
  </>
}

/**
 * Challenges section of the Crew screen.
 *
 * @param {object} props
 * @param {string} props.myHandle
 * @param {Array<{handle: string, displayName: string}>} props.friends  Accepted friends, for the invite picker.
 * @returns {JSX.Element}
 */
export default function ChallengesCard({ myHandle, friends }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [list, setList] = useState(null)
  const load = useCallback(() => api('/api/social/challenges').then(r => setList(r.challenges)).catch(e => toast(e.message)), [toast])
  useEffect(() => { load() }, [load])

  if (!list) return null
  const g = groupChallenges(list, myHandle)
  const open = c => openSheet(close => <ChallengeDetail challenge={c} myHandle={myHandle} close={close} onChanged={load} />)
  const create = () => openSheet(close => <NewChallenge friends={friends} close={close} onCreated={load} />)

  const Row = ({ c }) => {
    const line = progressLine(c, myHandle)
    return (
      <button className="lrow tap" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => open(c)}>
        <div className="row between"><span className="lrow-t">{c.title}</span><span className="muted small">{line.current}/{line.target}</span></div>
        <Bar pct={line.pct} />
      </button>
    )
  }

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Challenges')}</h2>
        <Button size="sm" icon="plus" onClick={create}>{t('New')}</Button>
      </div>
      {g.invited.length > 0 && <>
        <div className="muted small">{t('Invitations')}</div>
        {g.invited.map(c => <Row key={c.id} c={c} />)}
      </>}
      {g.running.map(c => <Row key={c.id} c={c} />)}
      {!g.invited.length && !g.running.length && <div className="muted small">{t('No challenge yet. Start one with your friends.')}</div>}
      {g.past.length > 0 && <>
        <div className="muted small" style={{ marginTop: 10 }}>{t('Past')}</div>
        {g.past.slice(0, 5).map(c => <Row key={c.id} c={c} />)}
      </>}
    </div>
  )
}
