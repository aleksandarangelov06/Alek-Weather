import { memo, useState, useRef, useCallback, useEffect } from 'react'
import { Droplet, ArrowUp, ArrowDown, Equal, TreePine, Car, Footprints } from 'lucide-react'
import { getWeatherInfo, formatDay, formatHour, getUVLabel, liveWeatherCode, nowcastHourlyCode, toTemp, tempInk, tempStyle } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'
import { formatPrecip, formatWind } from '../utils/units'
import { coverAsPage, coverFrom, useCoverHistory } from '../utils/detailCover'
import { DetailCover } from './DetailCover'
import { dayWindow, direction, rateActivities, scoreColor, scoreLabel } from '../utils/todayOutlook'

// The Today tab's three ratings, in its order and with its icons.
const ACTIVITIES = [
  { id: 'outside',  label: 'Outdoors', Icon: TreePine },
  { id: 'driving',  label: 'Driving',  Icon: Car },
  { id: 'exercise', label: 'Exercise', Icon: Footprints },
]

const COMPARE_ICON = { warmer: ArrowUp, colder: ArrowDown, same: Equal }

// The day's weather icon beside its title, sized to the title.
const DAY_ICON_STYLE = { fontSize: 22 }

// The cover's two lengths. Keep in step with App.css: COVER_IN_MS is
// --cover-in (the rectangle growing out of the row — the strip waits for it),
// COVER_OUT_MS is --cover-content-out + --cover-out (content fading, then the
// rectangle shrinking back; the cover stays mounted for all of it).
const COVER_IN_MS = 380
const COVER_OUT_MS = 400

// Severity colours for the day cover's stats, mirroring the app-wide --cond-*
// scale (UV, air quality) so they track the theme in light and dark. Returned as
// CSS var strings; only applied when the daily colour-coding setting is on.
function humidityColor(pct) {
  if (pct < 25) return 'var(--cond-blue)'
  if (pct < 50) return 'var(--cond-green)'
  if (pct < 65) return 'var(--cond-yellow)'
  if (pct < 80) return 'var(--cond-orange)'
  return 'var(--cond-red)'
}

function windColor(mph) {
  if (mph < 5)  return 'var(--cond-green)'
  if (mph < 15) return 'var(--cond-lime)'
  if (mph < 25) return 'var(--cond-yellow)'
  if (mph < 35) return 'var(--cond-orange)'
  if (mph < 45) return 'var(--cond-red)'
  return 'var(--cond-purple)'
}

function precipColor(inches) {
  if (inches <= 0)   return 'var(--text-tertiary)'
  if (inches < 0.25) return 'var(--cond-blue)'
  return 'var(--accent)'
}

// "7:01 AM" from the forecast's local time ("2026-11-27T07:01"). Read off the
// string rather than through a Date, which would take it as the device's own
// time zone and shift it for a place in another.
function clockText(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso ?? '')
  if (!m) return null
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// The day's daylight: { length: "9h 32m", rise: "7:01 AM", set: "4:33 PM" },
// or null when either end is missing (polar day and night have neither).
function daylightOf(rise, set) {
  const a = clockText(rise), b = clockText(set)
  if (!a || !b) return null
  const mins = Math.round((Date.parse(set) - Date.parse(rise)) / 60000)
  if (!Number.isFinite(mins) || mins <= 0) return null
  return { length: `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`, rise: a, set: b }
}

// "Today, Jul 17" / "Friday, Jul 18" — full weekday for the cover title, where
// the abbreviated row label would look clipped.
function coverTitle(date) {
  const d = new Date(date + 'T12:00:00')
  const name = d.toDateString() === new Date().toDateString()
    ? 'Today'
    : d.toLocaleDateString('en-US', { weekday: 'long' })
  return `${name}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// Memoised: App re-renders for every overlay, toggle and keystroke, and the
// props here are the reading and the settings, which those leave alone.
export const DailyForecast = memo(function DailyForecast({ daily, hourly, timezone, unit, units, colorCoding = true, glow = true, frost = true, current, minutely, radarClear = null, yesterday = null, airQuality = null }) {
  const [expanded, setExpanded] = useState(null)
  const [closing, setClosing] = useState(false)
  // The tapped row's box, which the cover grows out of (see coverFrom).
  const [from, setFrom] = useState(() => coverFrom(null))
  // Opened as a full-screen page rather than over the card (connected layout;
  // see coverAsPage). Fixed for as long as the day stays open.
  const [asPage, setAsPage] = useState(false)
  // The day cover's hourly strip is ~24 icon items; building it synchronously on
  // tap blocks the reveal's first frames and makes the open stutter. Hold it back
  // until the reveal has finished, then fade it in — nothing competes with the
  // animation. (The detail-card cover has no such strip, which is why only the
  // 7-day open lagged.)
  const [hoursReady, setHoursReady] = useState(false)
  const cardRef = useRef(null)
  const closeTimer = useRef(null)
  const hoursTimer = useRef(null)

  // Hold the hourly strip back until the rectangle has filled the card, counted
  // from the moment it actually starts growing. That is not the tap: armCover below gives the mount a
  // couple of frames first, and a delay counted from the tap therefore expires
  // *inside* the animation's last frames — where mounting ~24 icon items takes
  // them, and a reveal missing its last frames is one that looks cut short.
  const scheduleHours = () => {
    clearTimeout(hoursTimer.current)
    hoursTimer.current = setTimeout(() => setHoursReady(true), COVER_IN_MS)
  }

  const closeDay = () => {
    setClosing(true)
    clearTimeout(hoursTimer.current)
    setHoursReady(false)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setExpanded(null); setClosing(false) }, COVER_OUT_MS)
  }

  // The cover grows out of the row that was tapped, as a rectangle, to fill
  // the card — the same opening as the detail tiles. Every way out (the header, Esc, a second tap on the open row, the back
  // gesture) goes through history; see useCoverHistory.
  const dismissDay = useCoverHistory(expanded !== null && !closing, closeDay)

  const openDay = (date, e) => {
    if (expanded === date) { dismissDay(); return }
    // Switching days keeps the open cover, which is already full; only a fresh
    // open reads this.
    if (expanded === null) {
      setFrom(coverFrom(e?.currentTarget, '.card--daily'))
      setAsPage(coverAsPage())
    }
    clearTimeout(closeTimer.current)
    setClosing(false)
    const wasOpen = expanded !== null
    setExpanded(date)
    // Defer the hourly strip past the reveal (see hoursReady above). On a fresh
    // open the cover is about to mount, so armCover owns the timing and starts the
    // clock when it lets the animation go. Switching from one day to another keeps
    // the cover it already has: nothing arms, nothing replays, so the wait is only
    // to keep the strip's own render off the frame that swapped the day.
    setHoursReady(false)
    clearTimeout(hoursTimer.current)
    if (wasOpen) scheduleHours()
  }

  useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(hoursTimer.current) }, [])

  // A cover that has just mounted has to be laid out, painted and promoted to a
  // composited layer before anything can move it, and the reveal starts on that
  // same frame — so what gets dropped is the beginning of the animation. The two
  // phone styles are where it shows, because they're where that paint is dear:
  // glass rims and inset highlights over a blurred backdrop under iOS, tonal
  // fills over a 28px radius under Android, against flat surfaces on web. And it
  // shows on opening only, because closing moves a layer that is already
  // rasterised.
  //
  // So the mount gets a frame to itself. --arming pins both animations to their
  // start state; it goes on during the commit, which is before the browser has
  // painted, and comes off two frames later. Two, because the first rAF still
  // runs ahead of that paint — the second is the first one with a rasterised
  // layer to animate. The whole cost is one frame of latency on the tap.
  const armCover = useCallback((el) => {
    if (!el) return
    el.classList.add('detail-cover--arming')
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.remove('detail-cover--arming')
      // This is the frame the reveal begins on, so it is the frame the strip's
      // wait has to be measured from — see scheduleHours.
      scheduleHours()
    }))
  }, [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') dismissDay() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded]) // eslint-disable-line react-hooks/exhaustive-deps

  const scrollRef = useRef(null)
  const cleanupRef = useRef(null)

  // Callback ref: bind the wheel listener the moment the strip mounts so vertical
  // wheel scrolling moves the strip horizontally — same as the hourly forecast.
  const setScrollEl = useCallback((el) => {
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null }
    scrollRef.current = el
    if (!el) return
    const onWheel = (e) => {
      e.preventDefault()
      el.scrollLeft += e.deltaY + e.deltaX
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    cleanupRef.current = () => el.removeEventListener('wheel', onWheel)
  }, [])

  const scroll = (dir) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  const maxTemps = daily.temperature_2m_max
  const minTemps = daily.temperature_2m_min
  const weekMin = Math.min(...minTemps)
  const weekMax = Math.max(...maxTemps)
  const range = weekMax - weekMin || 1

  // Which hourly slots fall on a given day (date is "YYYY-MM-DD"). One pass of
  // string compares and nothing else — this is the half of the work the tap
  // frame needs (the cover's humidity average), kept apart from the half it
  // doesn't (below).
  const dayIndices = (date) => {
    const out = []
    if (!hourly?.time) return out
    for (let i = 0; i < hourly.time.length; i++) {
      if (hourly.time[i].startsWith(date)) out.push(i)
    }
    return out
  }

  // The strip's entries, with the same live/nowcast corrections the main hourly
  // strip uses. Deliberately called only once hoursReady is set: a timezone
  // format plus a scan of the whole minutely series per slot is real main-thread
  // work, and on the tap frame it lands where the reveal is trying to start.
  const hoursForDay = (indices) => {
    if (!hourly?.time) return []
    // Current hour string in the location's timezone, e.g. "2025-06-23T17:00"
    const localNow = new Date().toLocaleString('sv', { timeZone: timezone })
    const currentHourStr = `${localNow.slice(0, 10)}T${localNow.slice(11, 13)}:00`
    const out = []
    for (const i of indices) {
      const slotTime = hourly.time[i]
      const rawCode = hourly.weather_code[i]
      let code
      if (slotTime === currentHourStr && current) {
        code = liveWeatherCode(current, minutely, radarClear) ?? rawCode
      } else if (slotTime > currentHourStr) {
        code = nowcastHourlyCode(rawCode, minutely, slotTime, current)
      } else {
        code = rawCode
      }
      const prob = hourly.precipitation_probability?.[i] ?? 0
      out.push({
        time: slotTime,
        temp: hourly.temperature_2m[i],
        code,
        precip: prob,
        isDay: hourly.is_day?.[i],
      })
    }
    return out
  }

  // Everything the open cover shows about the tapped day.
  const di = expanded ? daily.time.indexOf(expanded) : -1
  const openInfo = di !== -1 ? getWeatherInfo(daily.weather_code[di]) : null
  const openIdx = di !== -1 ? dayIndices(expanded) : []
  const openHours = hoursReady && di !== -1 ? hoursForDay(openIdx) : []
  const openPrecip = di !== -1
    ? (daily.precipitation_probability_max[di] ?? 0)
    : 0
  const precipNote = openPrecip > 0
    ? `Up to a ${openPrecip}% chance of precipitation.`
    : 'No precipitation expected.'

  // "Today" in the forecast's own timezone, for the ratings window and for
  // naming the neighbouring days. Only worked out while a day is open.
  let todayStr = null, hourStr = null
  if (di !== -1) {
    const now = new Date()
    todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone })
    // en-CA gives "24" for midnight on some engines; the hourly times use "00".
    hourStr = now.toLocaleString('en-CA', { hour: '2-digit', hour12: false, timeZone: timezone }).replace(/^24$/, '00')
  }

  // The Today tab's conditions for the open day: its 1-10 ratings for being
  // outdoors, driving and exercise, over that day's waking hours (from now on,
  // for today, so this and the Today tab agree).
  const openWin = di !== -1 ? dayWindow(hourly, expanded, todayStr, hourStr) : null
  const openRatings = openWin ? rateActivities(hourly, openWin, airQuality?.hourly) : null

  // The open day's high against the days either side of it. Today's day before
  // is yesterday, which useWeather keeps aside from the daily arrays.
  const neighbours = di === -1 ? [] : [
    di > 0
      ? { date: daily.time[di - 1], max: maxTemps[di - 1] }
      : yesterday?.max != null ? { date: yesterday.date, max: yesterday.max } : null,
    di + 1 < daily.time.length ? { date: daily.time[di + 1], max: maxTemps[di + 1] } : null,
  ]
  // Relative words only where they're unambiguous: "tomorrow" on today's cover
  // means the next day, but on Monday's it would read as Sunday's name for
  // itself, so every other day goes by its weekday.
  const nameOf = (date) => {
    if (date === todayStr) return 'today'
    if (date < todayStr) return 'yesterday'
    if (expanded === todayStr) return 'tomorrow'
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })
  }
  const compares = di === -1 || maxTemps[di] == null ? [] : neighbours
    .filter(n => n && n.max != null)
    .map(n => {
      const diffF = maxTemps[di] - n.max
      // A difference in the display unit, as on the Today tab: °C steps are
      // bigger, so the same pair can be "4° colder" in °F and "2°" in °C.
      const d = Math.round(Math.abs(unit === 'C' ? diffF * 5 / 9 : diffF))
      const dir = d === 0 ? 'same' : direction(diffF)
      const name = nameOf(n.date)
      return {
        key: n.date,
        dir,
        text: dir === 'same' ? `About the same as ${name}` : `${d}° ${dir} than ${name}`,
      }
    })

  // Precip accumulation (in) and peak wind (mph) come straight from the daily
  // series; humidity has no daily aggregate, so average the day's hourly values.
  const precipSum = di !== -1 ? daily.precipitation_sum?.[di] : null
  const windMax   = di !== -1 ? daily.wind_speed_10m_max?.[di] : null
  // No daily gust aggregate either: the day's peak hourly gust.
  const gustVals  = openIdx.map(i => hourly?.wind_gusts_10m?.[i]).filter(v => v != null)
  const gustMax   = gustVals.length ? Math.max(...gustVals) : null
  const humVals   = openIdx.map(i => hourly?.relative_humidity_2m?.[i]).filter(v => v != null)
  const humidityAvg = humVals.length
    ? Math.round(humVals.reduce((a, b) => a + b, 0) / humVals.length)
    : null
  // The second row of readings. Feels-like has no daily aggregate either, so
  // it is the day's hourly range.
  const feelsVals = openIdx.map(i => hourly?.apparent_temperature?.[i]).filter(Number.isFinite)
  const feelsHigh = feelsVals.length ? Math.max(...feelsVals) : null
  const feelsLow  = feelsVals.length ? Math.min(...feelsVals) : null
  const uvMax     = di !== -1 && Number.isFinite(daily.uv_index_max?.[di]) ? daily.uv_index_max[di] : null
  const daylight  = di !== -1 ? daylightOf(daily.sunrise?.[di], daily.sunset?.[di]) : null

  return (
    <div className="card card--daily" ref={cardRef}>
      <div className="section-label">7-DAY FORECAST</div>
      <div className="daily-list">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i])
          const high = toTemp(maxTemps[i], unit)
          const low = toTemp(minTemps[i], unit)
          // The day's peak chance as forecast — not "right now", and not inferred
          // from the row's icon.
          const precip = daily.precipitation_probability_max?.[i] ?? 0

          // Map this day's low→high onto the week's overall range so pill
          // position and width carry the actual temperature magnitudes. The
          // low/high numbers ride the pill's ends (see .daily-range CSS), so the
          // whole cluster shifts and scales together — quick to compare at a glance.
          const barLeft = ((minTemps[i] - weekMin) / range) * 100
          const barWidth = ((maxTemps[i] - minTemps[i]) / range) * 100
          const pillWidth = Math.max(barWidth, 8) // keep a capsule even for flat days
          const pillLeft = Math.min(barLeft, 100 - pillWidth)
          const pillRight = pillLeft + pillWidth

          const p = precip ?? 0
          // Marked open only under the cover over the card; as a page
          // (connected layout) the row's open highlight would only show
          // through for a moment as the page closed.
          const isExpanded = expanded === date && !asPage
          return (
            <div
              key={date}
              className={`daily-row daily-row--expand${isExpanded ? ' daily-row--active' : ''}`}
              onClick={(e) => openDay(date, e)}
              role="button"
              aria-expanded={isExpanded}
            >
              <span className="daily-icon">
                <WeatherIcon id={info.icon} alt={info.label} />
              </span>
              <span className="daily-day">{formatDay(date)}</span>
              {/* Shown on every day, 0% included: a blank cell left a dry day
                  looking like missing data rather than a forecast of no rain.
                  The droplet names the unit: a bare "45%" could read as
                  humidity or cloud cover, and aria-label carries that meaning
                  to screen readers, which otherwise hear only "45%". */}
              <span
                className="daily-precip-badge"
                aria-label={`${p}% chance of precipitation`}
              >
                <Droplet className="daily-precip-drop" aria-hidden="true" />
                <span className="daily-precip-num">{p}%</span>
              </span>
              <div className="daily-range">
                <div className="daily-range-inner">
                  <span className="daily-low" style={{ ...tempStyle(minTemps[i], colorCoding, 0.4, glow, frost), left: `${pillLeft}%` }}>{low}°</span>
                  <div className="bar-fill" style={{
                    left: `${pillLeft}%`,
                    width: `${pillWidth}%`,
                    background: colorCoding
                      ? `linear-gradient(90deg, ${tempInk(minTemps[i])}, ${tempInk(maxTemps[i])})`
                      : 'var(--daily-bar-bg)',
                  }} />
                  <span className="daily-high" style={{ ...tempStyle(maxTemps[i], colorCoding, 0.4, glow, frost), left: `${pillRight}%` }}>{high}°</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {expanded && di !== -1 && (
        <DetailCover
          page={asPage}
          variant="daily"
          coverRef={armCover}
          closing={closing}
          from={from}
          title={coverTitle(expanded)}
          icon={<WeatherIcon id={openInfo.icon} alt="" />}
          iconStyle={DAY_ICON_STYLE}
          onClose={dismissDay}
          bodyClass="day-cover-body"
        >
            {/* The day at a glance: high / low, the sky, and how the high sits
                against the days either side. The chance of rain that used to
                be the line here is in the Precip stat below. */}
            <div className="detail-summary">
              <div className="detail-summary-val">
                <span style={tempStyle(maxTemps[di], colorCoding, 0.4, glow, frost)}>{toTemp(maxTemps[di], unit)}°</span>
                <span className="detail-summary-unit"> / </span>
                <span className="detail-summary-unit" style={tempStyle(minTemps[di], colorCoding, 0.4, glow, frost)}>{toTemp(minTemps[di], unit)}°</span>
              </div>
              <div className="detail-summary-text">
                <div className="detail-summary-label">{openInfo.label}</div>
                {compares.length > 0 ? (
                  <ul className="day-compare" aria-label="High compared with nearby days">
                    {compares.map(({ key, dir, text }) => {
                      const Icon = COMPARE_ICON[dir]
                      return (
                        <li key={key} className={`day-compare-row day-compare--${dir}`}>
                          <Icon size={14} className="day-compare-icon" aria-hidden="true" />
                          <span>{text}</span>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="detail-summary-note">{precipNote}</div>
                )}
              </div>
            </div>

            {/* The Today tab's conditions, for this day: the overall score in
                the heading, then the three activities side by side. */}
            {openRatings && (
              <section className="day-cond" aria-label="Conditions">
                <div className="day-cond-head">
                  <span className="day-cond-title">
                    Conditions
                    {openWin.label !== 'Daytime' && <span className="day-cond-when"> · {openWin.label}</span>}
                  </span>
                  <span className="day-cond-overall">
                    <span className="today-dot" style={{ background: scoreColor(openRatings.overall) }} />
                    {scoreLabel(openRatings.overall)}
                    <span className="day-cond-overall-score">{openRatings.overall}/10</span>
                  </span>
                </div>
                <div className="day-cond-grid">
                  {ACTIVITIES.map(({ id, label, Icon }) => {
                    const r = openRatings[id]
                    return (
                      <div
                        key={id}
                        className="day-cond-cell"
                        role="meter" aria-valuemin={1} aria-valuemax={10} aria-valuenow={r.score}
                        aria-label={`${label}: ${r.score} out of 10, ${r.reason}`}
                      >
                        <div className="day-cond-top">
                          <Icon size={14} className="day-cond-icon" aria-hidden="true" />
                          <span className="day-cond-name">{label}</span>
                          <span className="day-cond-score">{r.score}</span>
                        </div>
                        <div className="day-cond-bar">
                          <i style={{ width: `${r.score * 10}%`, background: scoreColor(r.score) }} />
                        </div>
                        <div className="day-cond-reason">{r.reason}</div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Three readings as tiles on the same grid as the conditions
                above, so the two rows line up column for column: a label, the
                reading, and one line of detail, like the activity tiles. UV
                isn't here; it counts toward the Outdoors and Exercise scores. */}
            <div className="day-stats">
              <div className="day-stat">
                <span className="day-stat-label">Precip</span>
                <span className="day-stat-value" style={colorCoding && precipSum != null ? { color: precipColor(precipSum) } : undefined}>{openPrecip}%</span>
                <span className="day-stat-sub">{precipSum != null ? formatPrecip(precipSum, units) : 'Chance'}</span>
              </div>
              <div className="day-stat">
                <span className="day-stat-label">Wind</span>
                <span className="day-stat-value" style={colorCoding && windMax != null ? { color: windColor(windMax) } : undefined}>{formatWind(windMax, units)}</span>
                <span className="day-stat-sub">{gustMax != null ? `Gusts ${formatWind(gustMax, units)}` : 'Peak'}</span>
              </div>
              <div className="day-stat">
                <span className="day-stat-label">Humidity</span>
                <span className="day-stat-value" style={colorCoding && humidityAvg != null ? { color: humidityColor(humidityAvg) } : undefined}>{humidityAvg != null ? `${humidityAvg}%` : '-'}</span>
                <span className="day-stat-sub">Day average</span>
              </div>
              {/* A second row, from data the forecast already carries: the
                  day's feels-like range, its peak UV, and its daylight. */}
              {feelsHigh != null && (
                <div className="day-stat">
                  <span className="day-stat-label">Feels like</span>
                  <span className="day-stat-value">
                    <span style={tempStyle(feelsHigh, colorCoding, 0.4, glow, frost)}>{toTemp(feelsHigh, unit)}°</span>
                    <span className="day-stat-sep"> / </span>
                    <span style={tempStyle(feelsLow, colorCoding, 0.4, glow, frost)}>{toTemp(feelsLow, unit)}°</span>
                  </span>
                  <span className="day-stat-sub">High / low</span>
                </div>
              )}
              {uvMax != null && (
                <div className="day-stat">
                  <span className="day-stat-label">UV index</span>
                  <span className="day-stat-value" style={colorCoding ? { color: getUVLabel(uvMax).color } : undefined}>{Math.round(uvMax)}</span>
                  <span className="day-stat-sub">{getUVLabel(uvMax).label} at peak</span>
                </div>
              )}
              {daylight && (
                <div className="day-stat">
                  <span className="day-stat-label">Daylight</span>
                  <span className="day-stat-value">{daylight.length}</span>
                  <span className="day-stat-sub">{daylight.rise} to {daylight.set}</span>
                </div>
              )}
            </div>
            {hoursReady && openHours.length > 0 && (
              <div className="hourly-scroll-wrapper daily-hours-in">
                <button className="hourly-nav hourly-nav-left" onClick={() => scroll(-1)} aria-label="Scroll left">‹</button>
                <div className="hourly-scroll" ref={setScrollEl}>
                  {/* .hourly-track composites the scrolled content (will-change:
                      transform) so horizontal scroll is a cheap GPU translate —
                      same fix as the main hourly forecast strip. */}
                  <div className="hourly-track">
                    <div className="hourly-row">
                      {openHours.map((h, hi) => {
                        const hInfo = getWeatherInfo(h.code, !h.isDay)
                        const label = formatHour(h.time, timezone)
                        return (
                          <div key={hi} className="hourly-item">
                            <span className="hourly-time">{label}</span>
                            <span className="hourly-icon"><WeatherIcon id={hInfo.icon} alt={hInfo.label} /></span>
                            <span className="hourly-temp" style={tempStyle(h.temp, colorCoding, 0.4, glow, frost)}>{toTemp(h.temp, unit)}°</span>
                            <span className="hourly-precip">{h.precip}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <button className="hourly-nav hourly-nav-right" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
              </div>
            )}
        </DetailCover>
      )}
    </div>
  )
})
