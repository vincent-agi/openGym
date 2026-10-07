import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { addDaysIso } from '../lib/challenges.js'
import { planBreak, activeBreak, clearBreaks, MAX_BREAK_DAYS } from '../lib/breaks.js'
import {
  EMPTY_SOCIAL, DISPLAY_NAME_MAX, NOTIFY_OPTIONS, QUIET_HOURS, normalizeHandle, handleError, displayNameError, canEnableSharing, sharedFields
} from '../lib/social.js'
import { pushSupported } from '../lib/push.js'
import { Section, Row, SelectRow, Switch, Button, TextField } from './ui.jsx'
import { fmtDate } from '../lib/format.js'

const SHARE_OPTIONS = [
  { key: 'sessions', title: 'Sessions', subtitle: 'How many sessions you did this week and month.' },
  { key: 'consistency', title: 'Consistency', subtitle: 'Sessions done compared with your own plan.' },
  { key: 'streak', title: 'Week streak', subtitle: 'Consecutive weeks with at least one session.' },
  { key: 'prs', title: 'Personal records', subtitle: 'How many records you broke recently.' }
]

const FIELD_LABEL = { sessions: 'Sessions this week', consistency: 'Consistency', streak: 'Week streak', prs: 'Personal records' }

/**
 * Planned break: days off that the weekly plan skips, so being ill or away never lowers consistency.
 * The dates live in the user's own state; no reason is asked for or shared.
 *
 * @returns {JSX.Element}
 */
function BreakRow() {
  const breaks = useStore(s => s.S.breaks)
  const update = useStore(s => s.update)
  const today = todayISO()
  const current = activeBreak(breaks, today)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(addDaysIso(today, 6))

  if (current) {
    return (
      <Row icon="moon" iconTint="var(--orange)" title={t('Planned break')}
        subtitle={t('{0} → {1}. These days are left out of your plan.', fmtDate(current.from, true), fmtDate(current.to, true))}>
        <Button size="sm" onClick={() => update(s => { s.breaks = clearBreaks(s.breaks, today) })}>{t('End break')}</Button>
      </Row>
    )
  }
  return (
    <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }}>
      <span className="lrow-t">{t('Plan a break')}</span>
      <span className="lrow-s">{t('Ill, travelling or injured? Up to {0} days that never count against you. Nothing is shared about why.', MAX_BREAK_DAYS)}</span>
      <div className="row" style={{ gap: 8 }}>
        <TextField type="date" min={today} value={from} onChange={e => setFrom(e.target.value)} />
        <TextField type="date" min={from} value={to} onChange={e => setTo(e.target.value)} />
      </div>
      <Button variant="tinted" onClick={() => update(s => { s.breaks = planBreak(s.breaks, from, to, today) })}>{t('Start break')}</Button>
    </div>
  )
}

/**
 * "Friends & sharing" section of Settings.
 *
 * Renders nothing when the instance turned the module off. Settings live on the server (not in
 * the synced app state) so they cannot be spoofed by editing a backup file.
 *
 * @returns {JSX.Element | null}
 */
export default function SocialSettings() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [available, setAvailable] = useState(false)
  const [saved, setSaved] = useState(null)       // last settings stored on the server
  const [draft, setDraft] = useState(EMPTY_SOCIAL) // what the user is editing
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api('/api/config')
      .then(c => (c.social_enabled ? api('/api/social/me') : null))
      .then(r => { if (live && r) { setAvailable(true); setSaved(r.social); setDraft(r.social) } })
      .catch(() => {})
    return () => { live = false }
  }, [])

  if (!available || !saved) return null

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const handleMsg = draft.handle ? handleError(draft.handle) : null
  const nameMsg = draft.displayName ? displayNameError(draft.displayName) : null

  /** Sends a partial update; on success the server's answer becomes the new baseline. */
  const save = async patch => {
    setBusy(true)
    try {
      const r = await api('/api/social/me', { method: 'PUT', body: JSON.stringify(patch) })
      setSaved(r.social); setDraft(r.social)
      return true
    } catch (e) {
      toast(e.message || t('Could not save'))
      return false
    } finally { setBusy(false) }
  }

  const setShare = (key, v) => {
    const share = { ...draft.share, [key]: v }
    setDraft({ ...draft, share })
    if (saved.enabled) save({ share: { [key]: v } })
  }

  const toggleEnabled = async v => {
    if (v && !canEnableSharing(draft)) { toast(t('Choose a handle and a display name first')); return }
    await save(v ? { enabled: true, handle: normalizeHandle(draft.handle), displayName: draft.displayName.trim(), share: draft.share, hideRank: draft.hideRank } : { enabled: false })
  }

  const fields = sharedFields({ ...draft, enabled: saved.enabled })
  const setNotify = patch => save({ notify: patch })

  return (
    <>
      <Section title={t('Friends & sharing')}
        footer={t('Off by default. Friends only ever see the short summary below, never your weight, food, workouts or health settings.')}>
        <Row icon="personCircle" iconTint="var(--pink)" title={t('Share with friends')}
          subtitle={saved.enabled ? t('Friends you add can see your summary.') : t('Nobody can see anything about you.')}>
          <Switch checked={saved.enabled} disabled={busy} onChange={toggleEnabled} />
        </Row>
        {saved.enabled && <Row icon="heart" iconTint="var(--pink)" title={t('Open Crew')} subtitle={t('Friends, requests and your friend code.')}
          accessory="chevron" onClick={() => nav('/crew')} />}
        <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, paddingTop: 13, paddingBottom: 14 }}>
          <span className="lrow-t">{t('Handle')}</span>
          <TextField value={draft.handle} maxLength={20} autoCapitalize="none" autoCorrect="off" placeholder="lea_fit"
            onChange={e => setDraft({ ...draft, handle: normalizeHandle(e.target.value) })} />
          {handleMsg && <span className="lrow-s" style={{ color: 'var(--red)' }}>{t(handleMsg)}</span>}
          <span className="lrow-t" style={{ marginTop: 6 }}>{t('Display name')}</span>
          <TextField value={draft.displayName} maxLength={DISPLAY_NAME_MAX} placeholder="Léa"
            onChange={e => setDraft({ ...draft, displayName: e.target.value })} />
          {nameMsg && <span className="lrow-s" style={{ color: 'var(--red)' }}>{t(nameMsg)}</span>}
          {dirty && (
            <Button variant="primary" disabled={busy || !!handleMsg || !!nameMsg || (draft.handle === '' && draft.displayName === '')}
              onClick={() => save({ handle: draft.handle, displayName: draft.displayName })}>{t('Save')}</Button>
          )}
        </div>
        {SHARE_OPTIONS.map(o => (
          <Row key={o.key} icon="check" iconTint="var(--teal)" title={t(o.title)} subtitle={t(o.subtitle)}>
            <Switch checked={!!draft.share[o.key]} disabled={busy} onChange={v => setShare(o.key, v)} />
          </Row>
        ))}
        <BreakRow />
        <Row icon="moon" iconTint="var(--purple)" title={t('Hide my rank')}
          subtitle={t('Lists show no positions: encourage each other without ranking.')}>
          <Switch checked={draft.hideRank} disabled={busy}
            onChange={v => { setDraft({ ...draft, hideRank: v }); save({ hideRank: v }) }} />
        </Row>
      </Section>

      {saved.enabled && pushSupported() && (
        <Section title={t('Friend notifications')}
          footer={t('Needs notifications turned on above. All off by default, never at night, and always encouraging.')}>
          {NOTIFY_OPTIONS.map(o => (
            <Row key={o.key} icon="bell" iconTint="var(--orange)" title={t(o.title)} subtitle={t(o.subtitle)}>
              <Switch checked={!!saved.notify[o.key]} disabled={busy} onChange={v => setNotify({ [o.key]: v })} />
            </Row>
          ))}
          <SelectRow icon="moon" iconTint="var(--purple)" title={t('Quiet from')} value={saved.notify.quiet.from}
            options={QUIET_HOURS.map(h => ({ value: h, label: h }))} onChange={v => setNotify({ quiet: { from: v } })} />
          <SelectRow icon="moon" iconTint="var(--purple)" title={t('Quiet until')} value={saved.notify.quiet.to}
            options={QUIET_HOURS.map(h => ({ value: h, label: h }))} onChange={v => setNotify({ quiet: { to: v } })} />
        </Section>
      )}

      <Section title={t('What friends will see')}>
        {saved.enabled ? (
          <>
            <Row icon="personCircle" iconTint="var(--pink)" title={saved.displayName} subtitle={'@' + saved.handle} />
            {fields.map(f => <Row key={f.key} title={t(FIELD_LABEL[f.key])} value={f.example} />)}
            {!fields.length && <Row title={t('Only your name and handle.')} />}
          </>
        ) : (
          <Row title={t('Nothing. Turn sharing on to preview your summary.')} />
        )}
      </Section>
    </>
  )
}
