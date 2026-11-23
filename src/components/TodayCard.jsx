import { memo, useEffect, useRef, useState } from 'react'
import {
  ArrowDown, ArrowUp, Check, Thermometer, TreePine, Car, Footprints,
  CloudLightning, CloudHail, CloudSnow, CloudRain, CloudDrizzle, Wind, ThermometerSun,
  ThermometerSnowflake, CloudFog, Sun, Moon, CloudSun, Cloud, Haze, Gauge, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { toTemp, tempInk } from '../utils/weatherCodes'
import { formatWind } from '../utils/units'
import {
  outlookWindow, todayWindow, tomorrowWindow, showsTomorrow, compareWithYesterday,
  compareTomorrowWithToday, rateActivities, dayHazards, scoreLabel, scoreColor, direction,
} from '../utils/todayOutlook'

const ACTIVITIES = [
  { id: 'outside',  label: 'Outdoors', Icon: TreePine },
  { id: 'driving',  label: 'Driving',  Icon: Car },
  { id: 'exercise', label: 'Exercise', Icon: Footprints },
]

// The same severity palette the readings use elsewhere in the app.
const LEVEL_COLOR = {
  severe: 'var(--cond-red)', warning: 'var(--cond-orange)', caution: 'var(--cond-yellow)',
  info: 'var(--cond-info)', good: 'var(--cond-green)',
}

function hazardIcon(h, night) {
  switch (h.id) {
    case 'storm': return CloudLightning
    case 'ice':   return CloudHail
    case 'snow':  return CloudSnow
    case 'rain':  return h.level === 'info' ? CloudDrizzle : CloudRain
    case 'wind':  return Wind
    case 'heat':  return ThermometerSun
    case 'cold':  return ThermometerSnowflake
    case 'fog':   return CloudFog
    case 'uv':    return Sun
    case 'air':   return Haze
    default:      return h.sky === 'clear' ? (night ? Moon : Sun) : h.sky === 'partly' ? CloudSun : Cloud
  }
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// A whole number that counts up from 0 when `play` turns on (or when it
// remounts with it on), easing out over `duration` after `delay` ms; a later
// change of value (a refresh) counts on from the number already showing. React
// renders the final text; the count only rewrites that same text node while it
// runs, so a missed frame or reduced motion still leaves the right number.
function CountUp({ value, suffix = '', play, delay = 0, duration = 650 }) {
  const ref = useRef(null)
  const shownValue = useRef(null)
  useEffect(() => {
    const node = ref.current?.firstChild
    if (!node) return
    const final = `${value}${suffix}`
    if (!play || reducedMotion()) { node.nodeValue = final; return }
    const from = shownValue.current ?? 0
    const wait = shownValue.current == null ? delay : 0
    shownValue.current = value
    if (from === value) { node.nodeValue = final; return }
    let raf, t0 = null
    node.nodeValue = `${from}${suffix}`
    const tick = (t) => {
      if (t0 == null) t0 = t + wait
      const p = Math.max(0, Math.min(1, (t - t0) / duration))
      node.nodeValue = p >= 1 ? final : `${Math.round(from + (value - from) * (1 - (1 - p) ** 3))}${suffix}`
      if (p < 1) raf = requestAnimationFrame(tick)
      else node.nodeValue = final
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); node.nodeValue = final }
  }, [value, suffix, play, delay, duration])
  return <span ref={ref}>{`${value}${suffix}`}</span>
}

// `embedded`: drawn inside another card (the web current-weather card) rather
// than as a card of its own, so it drops the card surface.
// Memoised: App re-renders for every overlay, toggle and keystroke, and the
// props here are the reading and the settings, which those leave alone.
export const TodayCard = memo(function TodayCard({ hourly, daily, current, yesterday, timezone, unit, units, airQuality, embedded = false }) {
  // Which day the At a Glance card shows: null follows the clock (tomorrow from
  // 9pm), a tap pins it. `slide` is the direction the last tap moved, so the
  // pane slides in from that side; the first render doesn't animate.
  const [picked, setPicked] = useState(null)
  const [slide, setSlide] = useState(null)

  // The entrance plays when the card first scrolls into view, not on mount, so
  // a card further down the list isn't already settled by the time it's seen.
  const cardRef = useRef(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = cardRef.current
    if (!el || shown) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) { setShown(true); io.disconnect() }
    }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [shown])

  const now = new Date()
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
  // en-CA gives "24" for midnight on some engines; the hourly times use "00".
  const hourStr = now.toLocaleString('en-CA', { hour: '2-digit', hour12: false, timeZone: timezone }).replace(/^24$/, '00')
  const fmtTemp = (f) => `${toTemp(f, unit)}°`

  // A difference in the display unit: °C steps are bigger, so the same day can
  // be "4° colder" in °F and "2° colder" in °C.
  const delta = (diffF) => Math.round(Math.abs(unit === 'C' ? diffF * 5 / 9 : diffF))

  // The temperature comparison: today against yesterday, or tomorrow against today.
  const comparison = (tomorrow) => {
    const cmp = tomorrow
      ? compareTomorrowWithToday(daily)
      : compareWithYesterday({ hourly, daily, yesterday, current, todayStr, hourStr })
    if (!cmp) return { headline: null, thermoColor: undefined, detailRows: [] }
    const d = delta(cmp.diffF)
    const same = cmp.direction === 'same' || d === 0
    const word = cmp.direction === 'colder' ? 'colder' : 'warmer'
    let text
    if (tomorrow) text = same ? 'About the same as today' : `${d}° ${word} tomorrow`
    else {
      const when = cmp.basis === 'now' ? 'this time yesterday' : 'yesterday'
      text = same ? `About the same as ${when}` : `${d}° ${word} than ${when}`
    }
    const headline = same
      ? { text, Icon: Check, cls: 'same' }
      : { text, Icon: cmp.direction === 'colder' ? ArrowDown : ArrowUp, cls: cmp.direction }
    // The thermometer takes the colour of the temperature the headline is
    // about: now, or the day's high when it compares highs.
    const leadF = tomorrow ? cmp.high.tomorrow : (cmp.now ?? cmp.high).today
    const detailRows = tomorrow
      ? [
          ['High', cmp.high.tomorrow, `${fmtTemp(cmp.high.today)} today`],
          cmp.low && ['Low', cmp.low.tomorrow, `${fmtTemp(cmp.low.today)} today`],
        ].filter(Boolean)
      : [
          cmp.now && ['Now', cmp.now.today, `${fmtTemp(cmp.now.yesterday)} this time yesterday`],
          cmp.high && ['High', cmp.high.today, `${fmtTemp(cmp.high.yesterday)} yesterday`],
        ].filter(Boolean)
    return { headline, thermoColor: leadF != null ? tempInk(leadF) : undefined, detailRows }
  }

  // A reading's second line: how far it moved and from what ("↑3° from
  // 18°"), or "Same as yesterday" inside the 2°F the headline also calls the
  // same (see direction), so a "Same" headline never sits over a "↑1°".
  const changeNote = (r) => {
    const dir = direction(r.diffF)
    const d = delta(r.diffF)
    if (dir === 'same' || d === 0) return { cls: 'same', text: `Same as ${r.ref}` }
    return { cls: dir, arrow: `${dir === 'colder' ? '↓' : '↑'}${d}°`, text: `from ${fmtTemp(r.thenF)}` }
  }

  // The At a Glance temperature tile, laid out like the Conditions tile beside
  // it: the change big ("↑ 3°" over "warmer than this time yesterday", or
  // "Same" over "as this time yesterday"), then a two-line row per reading,
  // its temperature over what it moved from. Without anything to compare
  // against it is the day's high, with the low as its one row.
  const tempStats = (tomorrow) => {
    const cmp = tomorrow
      ? compareTomorrowWithToday(daily)
      : compareWithYesterday({ hourly, daily, yesterday, current, todayStr, hourStr })
    if (!cmp) {
      const i = tomorrow ? 1 : 0
      const hi = daily?.temperature_2m_max?.[i], lo = daily?.temperature_2m_min?.[i]
      if (hi == null) return null
      return {
        label: 'Temperature', cls: 'plain', bigNum: toTemp(hi, unit), ink: tempInk(hi),
        sub: `high ${tomorrow ? 'tomorrow' : 'today'}`,
        rows: lo != null ? [{ label: 'Low', f: lo }] : [],
      }
    }
    const d = delta(cmp.diffF)
    const same = cmp.direction === 'same' || d === 0
    const than = tomorrow ? 'today' : cmp.basis === 'now' ? 'this time yesterday' : 'yesterday'
    let rows
    if (tomorrow) {
      rows = [
        { label: 'High', f: cmp.high.tomorrow, diffF: cmp.high.diffF, thenF: cmp.high.today, ref: 'today' },
        cmp.low && { label: 'Low', f: cmp.low.tomorrow, diffF: cmp.low.diffF, thenF: cmp.low.today, ref: 'today' },
      ]
    } else {
      const lo = daily?.temperature_2m_min?.[0], loY = yesterday?.min
      rows = [
        cmp.now && { label: 'Now', f: cmp.now.today, diffF: cmp.now.diffF, thenF: cmp.now.yesterday, ref: 'yesterday' },
        cmp.high && { label: 'High', f: cmp.high.today, diffF: cmp.high.diffF, thenF: cmp.high.yesterday, ref: 'yesterday' },
        lo != null && loY != null && { label: 'Low', f: lo, diffF: lo - loY, thenF: loY, ref: 'yesterday' },
      ]
    }
    // The thermometer icon takes the colour of the temperature the headline is
    // about: now, or the high when it compares highs.
    const leadF = tomorrow ? cmp.high.tomorrow : (cmp.now ?? cmp.high).today
    return {
      label: tomorrow ? 'vs today' : 'vs yesterday',
      cls: same ? 'same' : cmp.direction,
      Icon: same ? null : cmp.direction === 'colder' ? ArrowDown : ArrowUp,
      big: same ? 'Same' : null,
      bigNum: same ? null : d,
      sub: same ? `as ${than}` : `${cmp.direction} than ${than}`,
      ink: leadF != null ? tempInk(leadF) : undefined,
      rows: rows.filter(Boolean),
    }
  }

  if (embedded) {
    const win = outlookWindow(hourly, todayStr, hourStr)
    const ratings = rateActivities(hourly, win, airQuality?.hourly)
    const { headline, thermoColor, detailRows } = comparison(!!win?.tomorrow)
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

  // ── At a Glance (the phone's block) ──
  const tomorrowWin = tomorrowWindow(hourly, todayStr)
  const autoDay = showsTomorrow(hourStr) && tomorrowWin ? 'tomorrow' : 'today'
  const day = picked === 'tomorrow' && !tomorrowWin ? 'today' : picked ?? autoDay
  const isTomorrow = day === 'tomorrow'
  const win = isTomorrow ? tomorrowWin : todayWindow(hourly, todayStr, hourStr)
  const evening = Number(hourStr) >= 18

  const ratings = rateActivities(hourly, win, airQuality?.hourly)
  const hazards = dayHazards(hourly, win, {
    aqHourly: airQuality?.hourly,
    fmt: {
      temp: fmtTemp,
      wind: (mph) => formatWind(mph, units),
      snow: (inches) => {
        if (units?.precip === 'mm') {
          const cm = inches * 2.54
          return `${cm < 1 ? cm.toFixed(1) : Math.round(cm)} cm`
        }
        return `${inches < 1 ? inches.toFixed(1) : Math.round(inches)} in`
      },
    },
  })
  const temp = tempStats(isTomorrow)
  // Tonight's window runs through the small hours, so its sky reads as night.
  const nightSky = !isTomorrow && evening

  const todayLabel = evening ? 'Tonight' : 'Today'
  const pick = (id) => {
    if (id === day) return
    setSlide(id === 'tomorrow' ? 'next' : 'prev')
    setPicked(id)
  }

  // Stagger order for the entrance: the tiles, then each banner. The numbers
  // start counting as their tile lands (CSS steps 70ms a tile on entry and
  // 45ms on a day switch; see "At a Glance motion").
  let order = 0
  const tempAt = temp ? order++ : -1
  const condAt = ratings ? order++ : -1
  const alertsAt = order
  const countDelay = (i) => (slide ? 80 + i * 45 : 160 + i * 70)

  return (
    <div ref={cardRef} className={`card glance-card${shown ? ' glance-card--shown' : ''}`}>
      <div className="glance-head">
        <div className="section-label">AT A GLANCE</div>
        {/* A pager: the day showing, between a chevron back to today and one on
            to tomorrow. Each chevron greys out at its end. */}
        <div className="glance-days" role="group" aria-label="Day to show">
          <button
            type="button"
            className="glance-nav"
            onClick={() => pick('today')}
            disabled={!isTomorrow}
            aria-label={`Show ${todayLabel.toLowerCase()}`}
          >
            <ChevronLeft size={18} strokeWidth={2.25} aria-hidden="true" />
          </button>
          <span
            key={day}
            className={`glance-days-label${slide ? ` glance-days-label--${slide}` : ''}`}
            aria-live="polite"
          >
            {isTomorrow ? 'Tomorrow' : todayLabel}
          </span>
          <button
            type="button"
            className="glance-nav"
            onClick={() => pick('tomorrow')}
            disabled={isTomorrow || !tomorrowWin}
            aria-label="Show tomorrow"
          >
            <ChevronRight size={18} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div key={day} className={`glance-pane${slide ? ` glance-pane--${slide}` : ''}`}>
        {(temp || ratings) && (
          <div className="glance-stats">
            {temp && (
              <div className="glance-tile glance-anim" style={{ '--i': tempAt }}>
                <div className="glance-tile-label">
                  <Thermometer size={13} style={{ color: temp.ink }} aria-hidden="true" />
                  {temp.label}
                </div>
                <div className="glance-head-block">
                  <div className={`glance-big glance-big--${temp.cls}`}>
                    {temp.Icon && <temp.Icon size={22} strokeWidth={2.75} className="glance-big-icon" aria-hidden="true" />}
                    {temp.bigNum != null
                      ? <CountUp value={temp.bigNum} suffix="°" play={shown} delay={countDelay(tempAt)} />
                      : <span>{temp.big}</span>}
                  </div>
                  <div className="glance-sub">{temp.sub}</div>
                </div>
                {temp.rows.length > 0 && (
                  <div className="glance-rows">
                    {temp.rows.map(r => {
                      const n = r.diffF != null ? changeNote(r) : null
                      return (
                        <div key={r.label} className="glance-item">
                          <span className="glance-item-name">{r.label}</span>
                          <span className="glance-item-value">{fmtTemp(r.f)}</span>
                          {n && (
                            <span className="glance-item-note">
                              {n.arrow && <span className={`glance-item-change glance-item-change--${n.cls}`}>{n.arrow} </span>}
                              {n.text}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Conditions, in the same shape: the overall score as a ring out
                of 10 with its word and the stretch of the day it covers, then
                a two-line row per activity, its score over the reason for it
                (once a tooltip only, which a phone never shows). */}
            {ratings && (
              <div className="glance-tile glance-anim" style={{ '--i': condAt }}>
                <div className="glance-tile-label">
                  <Gauge size={13} aria-hidden="true" />
                  Conditions
                </div>
                <div
                  className="glance-head-block glance-score"
                  style={{ '--score-c': scoreColor(ratings.overall) }}
                  role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={ratings.overall}
                  aria-label={`Conditions: ${ratings.overall} out of 10, ${scoreLabel(ratings.overall).toLowerCase()}, ${win.label.toLowerCase()}`}
                >
                  <span className="glance-ring" aria-hidden="true">
                    <svg viewBox="0 0 44 44">
                      <circle className="glance-ring-track" cx="22" cy="22" r="19" pathLength="100" />
                      <circle
                        className="glance-ring-fill"
                        cx="22" cy="22" r="19" pathLength="100"
                        style={{ strokeDasharray: `${ratings.overall * 10} 100` }}
                      />
                    </svg>
                    <CountUp value={ratings.overall} play={shown} delay={countDelay(condAt)} />
                  </span>
                  <span className="glance-score-text" aria-hidden="true">
                    <span className="glance-score-word">{scoreLabel(ratings.overall)}</span>
                    <span className="glance-score-when">{win.label}</span>
                  </span>
                </div>
                <div className="glance-rows">
                  {ACTIVITIES.map(({ id, label, Icon }, row) => {
                    const r = ratings[id]
                    return (
                      <div
                        key={id}
                        className="glance-item glance-item--icon"
                        style={{ '--r': row, '--score-c': scoreColor(r.score) }}
                        role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={r.score}
                        aria-label={`${label}: ${r.score} out of 10, ${r.reason}`}
                      >
                        <Icon size={14} className="glance-item-icon" aria-hidden="true" />
                        <span className="glance-item-name" aria-hidden="true">{label}</span>
                        <span className="glance-item-value glance-item-score" aria-hidden="true">{r.score}</span>
                        <span className="glance-item-note" aria-hidden="true">{r.reason}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {hazards.length > 0 && (
          <ul className="glance-alerts" aria-label="What to expect">
            {hazards.map((h, n) => {
              const Icon = hazardIcon(h, nightSky)
              return (
                <li
                  key={h.id}
                  className={`glance-alert glance-alert--${h.level} glance-anim`}
                  style={{ '--glance-c': LEVEL_COLOR[h.level], '--i': alertsAt + n }}
                >
                  <span className="glance-alert-icon"><Icon size={18} className="glance-alert-svg" aria-hidden="true" /></span>
                  <div className="glance-alert-body">
                    <div className="glance-alert-top">
                      <span className="glance-alert-label">{h.label}</span>
                      <span className="glance-alert-when">{h.when}</span>
                    </div>
                    <div className="glance-alert-detail">
                      {h.scattered ? `On and off, ${lowerFirst(h.detail)}` : h.detail}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
})
