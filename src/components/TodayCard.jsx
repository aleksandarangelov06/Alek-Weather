import { memo } from 'react'
import { ArrowDown, ArrowUp, Check, Thermometer, TreePine, Car, Footprints } from 'lucide-react'
import { toTemp, tempInk } from '../utils/weatherCodes'
import { outlookWindow, compareWithYesterday, compareTomorrowWithToday, rateActivities, scoreLabel } from '../utils/todayOutlook'

const ACTIVITIES = [
  { id: 'outside',  label: 'Outdoors', Icon: TreePine },
  { id: 'driving',  label: 'Driving',  Icon: Car },
  { id: 'exercise', label: 'Exercise', Icon: Footprints },
]

// The same severity palette the rest of the app uses for readings, so a 3/10
// reads as the same orange as a poor air quality.
function scoreColor(score) {
  if (score >= 9) return 'var(--cond-green)'
  if (score >= 7) return 'var(--cond-lime)'
  if (score >= 5) return 'var(--cond-yellow)'
  if (score >= 3) return 'var(--cond-orange)'
  return 'var(--cond-red)'
}

// `embedded`: drawn inside another card (the web current-weather card) rather
// than as a card of its own, so it drops the card surface.
// Memoised: App re-renders for every overlay, toggle and keystroke, and the
// props here are the reading and the settings, which those leave alone.
export const TodayCard = memo(function TodayCard({ hourly, daily, current, yesterday, timezone, unit, airQuality, embedded = false }) {
  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  // en-CA gives "24" for midnight on some engines; the hourly times use "00".
  const hourStr = now.toLocaleString('en-CA', { hour: '2-digit', hour12: false, timeZone: timezone }).replace(/^24$/, '00')

  const win = outlookWindow(hourly, todayStr, hourStr)
  // From 9pm the whole card is about tomorrow (as long as tomorrow's hours
  // are there to rate): its high against today's, and its ratings.
  const tomorrow = !!win?.tomorrow
  const cmp = tomorrow
    ? compareTomorrowWithToday(daily)
    : compareWithYesterday({ hourly, daily, yesterday, current, todayStr, hourStr })
  const ratings = rateActivities(hourly, win, airQuality?.hourly)
  const fmtTemp = (f) => `${toTemp(f, unit)}°`

  // A difference in the display unit: °C steps are bigger, so the same day can
  // be "4° colder" in °F and "2° colder" in °C.
  const delta = (diffF) => Math.round(Math.abs(unit === 'C' ? diffF * 5 / 9 : diffF))

  let headline = null
  if (cmp) {
    const d = delta(cmp.diffF)
    const same = cmp.direction === 'same' || d === 0
    const word = cmp.direction === 'colder' ? 'colder' : 'warmer'
    let text
    if (tomorrow) text = same ? 'About the same as today' : `${d}° ${word} tomorrow`
    else {
      const when = cmp.basis === 'now' ? 'this time yesterday' : 'yesterday'
      text = same ? `About the same as ${when}` : `${d}° ${word} than ${when}`
    }
    headline = same
      ? { text, Icon: Check, cls: 'same' }
      : { text, Icon: cmp.direction === 'colder' ? ArrowDown : ArrowUp, cls: cmp.direction }
  }

  // The thermometer takes the colour of the temperature the headline is about:
  // now, or the day's high when it compares highs.
  const leadF = !cmp ? null : tomorrow ? cmp.high.tomorrow : (cmp.now ?? cmp.high).today
  const thermoColor = leadF != null ? tempInk(leadF) : undefined

  // The two lines under the headline (and the web card's tooltip).
  const detailRows = !cmp ? [] : tomorrow
    ? [
        ['High', cmp.high.tomorrow, `${fmtTemp(cmp.high.today)} today`],
        cmp.low && ['Low', cmp.low.tomorrow, `${fmtTemp(cmp.low.today)} today`],
      ].filter(Boolean)
    : [
        cmp.now && ['Now', cmp.now.today, `${fmtTemp(cmp.now.yesterday)} this time yesterday`],
        cmp.high && ['High', cmp.high.today, `${fmtTemp(cmp.high.yesterday)} yesterday`],
      ].filter(Boolean)

  if (embedded) {
    if (!headline && !ratings) return null
    // The web current card's version: the comparison and the overall score on
    // one line, then the three activities as columns of one panel. The longer
    // wording (now/high, each reason) is in the tooltips.
    const compareDetail = detailRows.map(([label, f, then]) => `${label} ${fmtTemp(f)} · ${then}`).join('\n')
    return (
      <div className="today-embed">
        <div className="te-top">
          {headline && (
            <span className={`te-compare te-compare--${headline.cls}`} title={compareDetail || undefined}>
              <headline.Icon size={14} aria-hidden="true" />
              <span>{headline.text}</span>
              <Thermometer size={16} className="te-compare-thermo" style={{ color: thermoColor }} aria-label="Temperature" />
            </span>
          )}
          {ratings && (
            <span
              className="te-overall"
              style={{ '--te-c': scoreColor(ratings.overall) }}
              title={`${scoreLabel(ratings.overall)} conditions · ${win.label}`}
            >
              <b>{ratings.overall}</b><small>/10</small>{scoreLabel(ratings.overall)}
            </span>
          )}
        </div>
        {ratings && (
          <div className="te-grid">
            {ACTIVITIES.map(({ id, label, Icon }) => {
              const r = ratings[id]
              return (
                <div
                  key={id}
                  className="te-cell"
                  style={{ '--te-c': scoreColor(r.score) }}
                  title={`${label}: ${r.reason}`}
                  role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={r.score}
                  aria-label={`${label}: ${r.score} out of 10, ${r.reason}`}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="te-cell-score">{r.score}</span>
                  <span className="te-cell-name">{label}</span>
                  <span className="te-cell-bar"><i style={{ width: `${r.score * 10}%` }} /></span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="card today-card">
      <div className="section-label">{tomorrow ? 'TOMORROW' : 'TODAY'}</div>

      {headline && (
        <div className="today-compare">
          <div className={`today-compare-head today-compare--${headline.cls}`}>
            <headline.Icon size={20} className="today-compare-icon" aria-hidden="true" />
            <span>{headline.text}</span>
          </div>
          <div className="today-compare-detail">
            {detailRows.length > 0 && (
              <span className="today-compare-thermo">
                <Thermometer size={24} style={{ color: thermoColor }} aria-label="Temperature" />
              </span>
            )}
            <div className="today-compare-rows">
              {detailRows.map(([label, f, then]) => (
                <span key={label}>{label} {fmtTemp(f)} <span className="today-dim">· {then}</span></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {ratings && (
        <div className="today-section">
          <div className="today-overall">
            <div className="today-overall-score">
              {ratings.overall}<span className="today-overall-of">/10</span>
            </div>
            <div>
              <div className="today-overall-label"><span className="today-dot" style={{ background: scoreColor(ratings.overall) }} />{scoreLabel(ratings.overall)} conditions</div>
              <div className="today-dim">{win.label}</div>
            </div>
          </div>
          <div className="today-acts">
            {ACTIVITIES.map(({ id, label, Icon }) => {
              const r = ratings[id]
              return (
                <div key={id} className="today-act">
                  <Icon size={18} className="today-act-icon" aria-hidden="true" />
                  <div className="today-act-body">
                    <div className="today-act-top">
                      <span className="today-act-label">{label}</span>
                      <span className="today-act-score">{r.score}/10</span>
                    </div>
                    <div
                      className="today-act-bar"
                      role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={r.score}
                      aria-label={`${label}: ${r.score} out of 10, ${r.reason}`}
                    >
                      <div className="today-act-fill" style={{ width: `${r.score * 10}%`, background: scoreColor(r.score) }} />
                    </div>
                    <div className="today-act-reason">{r.reason}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}


    </div>
  )
})
