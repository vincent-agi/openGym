import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import { exOr } from '../lib/exercises.js'
import { PRESSURE_RELIEF_EXERCISE_ID } from '../lib/pressureRelief.js'
import { exerciseDetailSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest, finishWorkEarly, stopWork } = useUI()
  const on = work || timer
  // The bar is fixed above the tab bar and floats over whatever is beneath it — during a
  // rest that was the next set's row. Extra bottom padding lets the page scroll clear.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  // Pressure-relief reminder (issue #26) — dismissible without touching the countdown itself,
  // and re-armed on the next rest period that actually carries one.
  const [prDismissed, setPrDismissed] = useState(false)
  useEffect(() => { setPrDismissed(false) }, [timer?.endsAt])
  if (!on) return null
  const pct = (on.left / on.total) * 100

  if (work) return (
    <div id="timer" className="working">
      <div className="t">{clock(work.left)}</div>
      <div className="grow">
        {work.label && <div className="lbl">{work.label}</div>}
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
    </div>
  )
  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: clock and bar
  // read at a glance, controls get their own row. −15 and +15 sit together in number-line
  // order; Skip is pushed to the far edge, away from the button you tap to buy more time.
  return (
    <div id="timer" className="rest">
      <div className="head">
        <div className="t">{clock(timer.left)}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      {timer.pressureRelief && !prDismissed && (
        <div className="pr-reminder">
          <Icon name="heart" />
          <span className="grow">{t('Time for a pressure relief — shift your weight or a chair push-up.')}</span>
          <button className="iconbtn" aria-label={t('Show me')} onClick={() => exerciseDetailSheet(exOr(PRESSURE_RELIEF_EXERCISE_ID))}><Icon name="chevronRight" /></button>
          <button className="iconbtn" aria-label={t('Dismiss')} onClick={() => setPrDismissed(true)}><Icon name="xmark" /></button>
        </div>
      )}
      <div className="acts">
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        {/* A dedicated, bigger "+30s" target (issue #24) — tappable repeatedly without ever
            resetting or ending the rest in progress, reachable right here with no extra nav. */}
        <Button size="sm" icon="plus" className="rest-ext30" onClick={() => addRest(30)}>30s</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Skip')}</Button>
      </div>
    </div>
  )
}
