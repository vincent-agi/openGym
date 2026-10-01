import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO, isoOf, fmtDate } from '../lib/format.js'
import { calcTargets, latestWeightKg, dayTotals, GOALS, ACTIVITY_LEVELS } from '../lib/nutrition.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, SelectRow } from '../components/ui.jsx'
import { mealLogSheet, deleteMealEntry } from '../sheets.jsx'

const GOAL_LABEL = { cut: 'Cut', maintain: 'Maintain', bulk: 'Bulk' }
const ACTIVITY_LABEL = {
  sedentary: 'Sedentary', light: 'Lightly active', moderate: 'Moderately active',
  active: 'Active', very_active: 'Very active'
}
const MACRO_COLOR = { protein: 'var(--blue)', carbs: 'var(--yellow)', fat: 'var(--orange)' }

function MacroBar({ macro, label, grams, target }) {
  const pct = target ? Math.min(100, (grams / target) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="row between small" style={{ marginBottom: 4 }}>
        <span>{label}</span>
        <span className="muted">{Math.round(grams)}{target ? ' / ' + target : ''} g</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-3)' }}>
        <div style={{ height: '100%', borderRadius: 3, width: pct + '%', background: MACRO_COLOR[macro] || 'var(--acc)', transition: 'width .2s' }} />
      </div>
    </div>
  )
}

export default function Nutrition() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [dayOffset, setDayOffset] = useState(0)
  const [goalDraft, setGoalDraft] = useState(S.nutrition?.goal || 'maintain')
  const [activityDraft, setActivityDraft] = useState('moderate')

  const date = new Date()
  date.setDate(date.getDate() + dayOffset)
  const iso = isoOf(date)
  const entries = S.nutrition?.log?.[iso] || []
  const totals = dayTotals(S, iso)
  const targets = S.nutrition?.targets?.kcal ? S.nutrition.targets : null

  const applyGoal = () => {
    const weightKg = latestWeightKg(S)
    const computed = calcTargets({ weightKg, goal: goalDraft, activityLevel: activityDraft })
    update(s => {
      s.nutrition = s.nutrition || { goal: null, targets: {}, log: {} }
      s.nutrition.goal = goalDraft
      if (computed) s.nutrition.targets = computed
    })
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Nutrition')}</h1><div className="sub">{iso === todayISO() ? t('Today') : fmtDate(iso, true)}</div></div>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setDayOffset(o => o - 1)} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{fmtDate(iso, true)}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setDayOffset(o => o + 1)} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>

      {!targets ? (
        <>
          <div className="muted small" style={{ marginBottom: 12 }}>{t('Pick a goal to get suggested calorie and macro targets from your logged bodyweight.')}</div>
          <Segmented options={GOALS.map(g => ({ value: g, label: t(GOAL_LABEL[g]) }))} value={goalDraft} onChange={setGoalDraft} />
          <div style={{ height: 8 }} />
          <SelectRow title={t('Activity level')} value={activityDraft}
            options={ACTIVITY_LEVELS.map(a => ({ value: a, label: t(ACTIVITY_LABEL[a]) }))}
            onChange={setActivityDraft} />
          <div style={{ height: 12 }} />
          <Button variant="primary" onClick={applyGoal}>{t('Set targets')}</Button>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'baseline', marginBottom: 14 }}>
            <div className="big">{Math.round(totals.kcal)}</div>
            <div className="muted">{t('/ {0} kcal', targets.kcal)}</div>
          </div>
          <MacroBar macro="protein" label={t('Protein')} grams={totals.protein} target={targets.protein} />
          <MacroBar macro="carbs" label={t('Carbs')} grams={totals.carbs} target={targets.carbs} />
          <MacroBar macro="fat" label={t('Fat')} grams={totals.fat} target={targets.fat} />
        </>
      )}
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>{t('Food log')}</h2>
        <Button size="sm" icon="plus" onClick={() => mealLogSheet(iso)}>{t('Add food')}</Button>
      </div>
      {entries.length ? (
        <div className="list" style={{ gap: 0 }}>
          {entries.map(e => (
            <div key={e.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
              <button className="lrow tap" style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => mealLogSheet(iso, e)}>
                <span className="lrow-m">
                  <span className="lrow-t">{e.name}</span>
                  <span className="lrow-s">{t('{0} kcal · P{1} C{2} F{3}', Math.round(e.kcal), Math.round(e.protein), Math.round(e.carbs), Math.round(e.fat))}</span>
                </span>
              </button>
              <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }}
                onClick={() => deleteMealEntry(iso, e.id)} aria-label={t('Delete')}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      ) : <div className="muted small">{t('Nothing logged for this day yet.')}</div>}
    </div>
  </>
}
