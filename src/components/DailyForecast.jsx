import { useState, useRef, useCallback, useEffect } from 'react'
import { X } from 'lucide-react'
import { getWeatherInfo, formatDay, formatHour, formatTime, getUVLabel, liveWeatherCode, nowcastHourlyCode, precipTier, toTemp, tempColor, tempStyle, displayPrecipChance } from '../utils/weatherCodes'
import { WeatherIcon } from './WeatherIcon'

// Keep in sync with the detail-cover animation duration in App.css — the cover
// stays mounted this long while the circle shrinks back into the tapped row.
const REVEAL_MS = 380

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

// "Today, Jul 17" / "Friday, Jul 18" — full weekday for the cover title, where
// the abbreviated row label would look clipped.
function coverTitle(date) {
  const d = new Date(date + 'T12:00:00')
  const name = d.toDateString() === new Date().toDateString()
    ? 'Today'
    : d.toLocaleDateString('en-US', { weekday: 'long' })
  return `${name}, ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export function DailyForecast({ daily, hourly, timezone, unit, colorCoding = true, glow = true, frost = true, current, minutely, radarClear = null }) {
  const [expanded, setExpanded] = useState(null)
  const [closing, setClosing] = useState(false)
  // Origin + radius of the circular reveal, in px relative to the daily card.
  const [reveal, setReveal] = useState({ x: 0, y: 0, r: 0 })
  const cardRef = useRef(null)
  const closeTimer = useRef(null)

  const closeDay = () => {
    setClosing(true)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => { setExpanded(null); setClosing(false) }, REVEAL_MS)
  }

  // Grow the cover from wherever the row was tapped — the same circular reveal
  // as the detail tiles. The radius is the distance to the card's farthest
  // corner, so the circle always finishes fully covering.
  const openDay = (date, e) => {
    if (expanded === date) { closeDay(); return }
    const rect = cardRef.current?.getBoundingClientRect()
    if (rect) {
      // Keyboard activation reports 0,0 — fall back to the card's center.
      const fromPointer = e && (e.clientX || e.clientY)
      const x = fromPointer ? e.clientX - rect.left : rect.width / 2
      const y = fromPointer ? e.clientY - rect.top  : rect.height / 2
      setReveal({ x, y, r: Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) })
    }
    clearTimeout(closeTimer.current)
    setClosing(false)
    setExpanded(date)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e) => { if (e.key === 'Escape') closeDay() }
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

  // Build the hourly entries that fall on a given day (date is "YYYY-MM-DD"),
  // applying the same live/nowcast corrections used by the main hourly strip.
  const hoursForDay = (date) => {
    if (!hourly?.time) return []
    // Current hour string in the location's timezone, e.g. "2025-06-23T17:00"
    const localNow = new Date().toLocaleString('sv', { timeZone: timezone })
    const currentHourStr = `${localNow.slice(0, 10)}T${localNow.slice(11, 13)}:00`
    const out = []
    for (let i = 0; i < hourly.time.length; i++) {
      if (!hourly.time[i].startsWith(date)) continue
      const slotTime = hourly.time[i]
      const rawCode = hourly.weather_code[i]
      let code
      if (slotTime === currentHourStr && current) {
        code = liveWeatherCode(current, minutely, radarClear) ?? rawCode
      } else if (slotTime > currentHourStr) {
        code = nowcastHourlyCode(rawCode, minutely, slotTime, current?.cloud_cover)
      } else {
        code = rawCode
      }
      const prob = precipTier(code) === 0 ? 0 : hourly.precipitation_probability?.[i]
      out.push({
        time: slotTime,
        temp: hourly.temperature_2m[i],
        code,
        precip: displayPrecipChance(code, prob),
        isDay: hourly.is_day?.[i],
        humidity: hourly.relative_humidity_2m?.[i],
      })
    }
    return out
  }

  // Everything the open cover shows about the tapped day.
  const di = expanded ? daily.time.indexOf(expanded) : -1
  const openInfo = di !== -1 ? getWeatherInfo(daily.weather_code[di]) : null
  const openHours = di !== -1 ? hoursForDay(expanded) : []
  const openPrecip = di !== -1
    ? (displayPrecipChance(daily.weather_code[di], daily.precipitation_probability_max[di]) ?? 0)
    : 0
  const precipNote = openPrecip > 0
    ? `Up to a ${openPrecip}% chance of precipitation.`
    : 'No precipitation expected.'

  // Precip accumulation (in) and peak wind (mph) come straight from the daily
  // series; humidity has no daily aggregate, so average the day's hourly values.
  const precipSum = di !== -1 ? daily.precipitation_sum?.[di] : null
  const windMax   = di !== -1 ? daily.wind_speed_10m_max?.[di] : null
  const humVals   = openHours.map(h => h.humidity).filter(v => v != null)
  const humidityAvg = humVals.length
    ? Math.round(humVals.reduce((a, b) => a + b, 0) / humVals.length)
    : null

  return (
    <div className="card card--daily" ref={cardRef}>
      <div className="section-label">7-DAY FORECAST</div>
      <div className="daily-list">
        {daily.time.map((date, i) => {
          const info = getWeatherInfo(daily.weather_code[i])
          const high = toTemp(maxTemps[i], unit)
          const low = toTemp(minTemps[i], unit)
          // Floor against the day's condition so the row's % never undercuts its
          // own rain icon. This is the day's peak chance, not "right now".
          const precip = displayPrecipChance(daily.weather_code[i], daily.precipitation_probability_max[i])

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
          const isExpanded = expanded === date
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
                {p > 0 && <span className="daily-precip-badge">{p}%</span>}
              </span>
              <span className="daily-day">{formatDay(date)}</span>
              <div className="daily-range">
                <div className="daily-range-inner">
                  <span className="daily-low" style={{ ...tempStyle(minTemps[i], colorCoding, 0.4, glow, frost), left: `${pillLeft}%` }}>{low}°</span>
                  <div className="bar-fill" style={{
                    left: `${pillLeft}%`,
                    width: `${pillWidth}%`,
                    background: colorCoding
                      ? `linear-gradient(90deg, ${tempColor(minTemps[i])}, ${tempColor(maxTemps[i])})`
                      : 'var(--bar-track-bg)',
                  }} />
                  <span className="daily-high" style={{ ...tempStyle(maxTemps[i], colorCoding, 0.4, glow, frost), left: `${pillRight}%` }}>{high}°</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {expanded && di !== -1 && (
        <div
          className={`detail-cover${closing ? ' detail-cover--closing' : ''}`}
          style={{
            '--reveal-x': `${reveal.x}px`,
            '--reveal-y': `${reveal.y}px`,
            '--reveal-r': `${reveal.r}px`,
          }}
          role="dialog"
          aria-label={coverTitle(expanded)}
        >
          <div className="detail-cover-head">
            <span className="detail-cover-title">
              <span className="detail-cover-icon" style={{ fontSize: 22 }}>
                <WeatherIcon id={openInfo.icon} alt="" />
              </span>
              {coverTitle(expanded)}
            </span>
            <button className="detail-cover-close" onClick={closeDay} aria-label="Close day details">
              <X size={20} />
            </button>
          </div>
          <div className="detail-cover-body">
            <div className="detail-summary">
              <div className="detail-summary-val">
                <span style={tempStyle(maxTemps[di], colorCoding, 0.4, glow, frost)}>{toTemp(maxTemps[di], unit)}°</span>
                <span className="detail-summary-unit"> / </span>
                <span className="detail-summary-unit" style={tempStyle(minTemps[di], colorCoding, 0.4, glow, frost)}>{toTemp(minTemps[di], unit)}°</span>
              </div>
              <div className="detail-summary-text">
                <div className="detail-summary-label">{openInfo.label}</div>
                <div className="detail-summary-note">{precipNote}</div>
              </div>
            </div>
            <div className="detail-stats">
              <div className="detail-stat">
                <span className="detail-stat-label">Precip</span>
                <span className="detail-stat-value" style={colorCoding && precipSum != null ? { color: precipColor(precipSum) } : undefined}>{precipSum != null ? `${precipSum.toFixed(2)} in` : '—'}</span>
              </div>
              <div className="detail-stat">
                <span className="detail-stat-label">Wind</span>
                <span className="detail-stat-value" style={colorCoding && windMax != null ? { color: windColor(windMax) } : undefined}>{windMax != null ? `${Math.round(windMax)} mph` : '—'}</span>
              </div>
              <div className="detail-stat">
                <span className="detail-stat-label">Humidity</span>
                <span className="detail-stat-value" style={colorCoding && humidityAvg != null ? { color: humidityColor(humidityAvg) } : undefined}>{humidityAvg != null ? `${humidityAvg}%` : '—'}</span>
              </div>
            </div>
            <div className="detail-stats">
              {daily.sunrise?.[di] && (
                <div className="detail-stat">
                  <span className="detail-stat-label">Sunrise</span>
                  <span className="detail-stat-value">{formatTime(daily.sunrise[di], timezone)}</span>
                </div>
              )}
              {daily.sunset?.[di] && (
                <div className="detail-stat">
                  <span className="detail-stat-label">Sunset</span>
                  <span className="detail-stat-value">{formatTime(daily.sunset[di], timezone)}</span>
                </div>
              )}
              {daily.uv_index_max?.[di] != null && (
                <div className="detail-stat">
                  <span className="detail-stat-label">Peak UV</span>
                  <span className="detail-stat-value" style={colorCoding ? { color: getUVLabel(daily.uv_index_max[di]).color } : undefined}>{Math.round(daily.uv_index_max[di])}</span>
                </div>
              )}
            </div>
            {openHours.length > 0 && (
              <div className="hourly-scroll-wrapper">
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
                        const precipClass = h.precip >= 30 ? 'hourly-precip high' : h.precip > 0 ? 'hourly-precip low' : 'hourly-precip zero'
                        return (
                          <div key={hi} className="hourly-item">
                            <span className="hourly-time">{label}</span>
                            <span className="hourly-icon"><WeatherIcon id={hInfo.icon} alt={hInfo.label} /></span>
                            <span className="hourly-temp" style={tempStyle(h.temp, colorCoding, 0.4, glow, frost)}>{toTemp(h.temp, unit)}°</span>
                            <span className={precipClass}>{h.precip}%</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <button className="hourly-nav hourly-nav-right" onClick={() => scroll(1)} aria-label="Scroll right">›</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
